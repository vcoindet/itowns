function requestNewTile(view, scheduler, geometryLayer, metadata, parent) {
    const command = {
        /* mandatory */
        view,
        requester: parent,
        layer: geometryLayer,
        priority: 10000,
        /* specific params */
        metadata,
        redraw: false,
    };

    return scheduler.execute(command);
}

function subdivideNode(context, layer, node) {
    if (!node.pendingSubdivision && node.children.filter(n => n.layer == layer.id).length == 0) {
        const childrenTiles = layer.tileIndex.index[node.tileId].children;
        if (childrenTiles === undefined || childrenTiles.length === 0) {
            return;
        }

        node.pendingSubdivision = true;

        const promises = [];
        for (let i = 0; i < childrenTiles.length; i++) {
            promises.push(
                requestNewTile(context.view, context.scheduler, layer, childrenTiles[i], node).then((tile) => {
                    node.add(tile);
                    tile.updateMatrixWorld();
                    if (node.additiveRefinement) {
                        context.view.notifyChange(true);
                    }
                }));
        }

        Promise.all(promises).then(() => {
            node.pendingSubdivision = false;
            context.view.notifyChange(true);
        });
    }
}

export function $3dTilesCulling(node, camera) {
    // For viewer Request Volume https://github.com/AnalyticalGraphicsInc/3d-tiles-samples/tree/master/tilesets/TilesetWithRequestVolume
    if (node.viewerRequestVolume) {
        const nodeViewer = node.viewerRequestVolume;
        if (nodeViewer.region) {
            // TODO
            return true;
        }
        if (nodeViewer.box) {
            // TODO
            return true;
        }
        if (nodeViewer.sphere) {
            const worldCoordinateCenter = nodeViewer.sphere.center.clone();
            worldCoordinateCenter.applyMatrix4(node.matrixWorld);
            // To check the distance between the center sphere and the camera
            if (!(camera.camera3D.position.distanceTo(worldCoordinateCenter) <= nodeViewer.sphere.radius)) {
                return true;
            }
        }
    }

    // For bounding volume
    if (node.boundingVolume) {
        const boundingVolume = node.boundingVolume;
        if (boundingVolume.region) {
            return !camera.isBox3Visible(boundingVolume.region.box3D, boundingVolume.region.matrixWorld);
        }
        if (boundingVolume.box) {
            return !camera.isBox3Visible(boundingVolume.box, node.matrixWorld);
        }
        if (boundingVolume.sphere) {
            return !camera.isSphereVisible(boundingVolume.sphere, node.matrixWorld);
        }
    }
    return false;
}

function removeChildren(n) {
    for (const child of n.children) {
        removeChildren(child);
    }
    n.remove(...n.children);
}


export function pre3dTilesUpdate(context, layer) {
    if (!layer.visible) {
        return [];
    }

    // pre-sse
    const hypotenuse = Math.sqrt(context.camera.width * context.camera.width + context.camera.height * context.camera.height);
    const radAngle = context.camera.camera3D.fov * Math.PI / 180;

     // TODO: not correct -> see new preSSE
    // const HFOV = 2.0 * Math.atan(Math.tan(radAngle * 0.5) / context.camera.ratio);
    const HYFOV = 2.0 * Math.atan(Math.tan(radAngle * 0.5) * hypotenuse / context.camera.width);
    context.camera.preSSE = hypotenuse * (2.0 * Math.tan(HYFOV * 0.5));

    // once in a while, garbage collect
    if (Math.random() < 0.98) {
        const now = Date.now();
        layer.root.traverse((n) => {
            if (n.layer != layer.id) {
                return;
            }

            // Browse children, and remove 'deletable' ones before
            // 'traverse' method visit them.
            for (let i = 0; i < n.children.length; i++) {
                const c = n.children[i];
                if (c.layer != layer.id) {
                    continue;
                }

                if ((now - c.notVisibleSince) > (layer.cleanupDelay || 3000)) {
                    c.traverse((o) => {
                        // Note: we don't check o.layer since we're
                        // going to remove 'c' from its parent so let's
                        // clean all of its children.

                        // free resources
                        if (o.material) {
                            o.material.dispose();
                        }
                        if (o.geometry) {
                            o.geometry.dispose();
                        }
                        // we can't remove 'o' from 'c' yet,
                        // because 'traverse' first applies the callback to a node
                        // and then to its children.
                    });

                    // remove c children recursively
                    removeChildren(c);
                    delete c.content;
                    n.remove(c);
                    i--;
                }
            }
        });
    }

    return [layer.root];
}

// Improved zoom geometry
function computeNodeSSE(camera, node) {
    if (node.boundingVolume.region) {
        const cameraLocalPosition = camera.camera3D.position.clone();
        cameraLocalPosition.x -= node.boundingVolume.region.matrixWorld.elements[12];
        cameraLocalPosition.y -= node.boundingVolume.region.matrixWorld.elements[13];
        cameraLocalPosition.z -= node.boundingVolume.region.matrixWorld.elements[14];
        const distance = node.boundingVolume.region.box3D.distanceToPoint(cameraLocalPosition);
        return camera.preSSE * (node.geometricError / distance);
    }
    if (node.boundingVolume.box) {
        const cameraLocalPosition = camera.camera3D.position.clone();
        cameraLocalPosition.x -= node.matrixWorld.elements[12];
        cameraLocalPosition.y -= node.matrixWorld.elements[13];
        cameraLocalPosition.z -= node.matrixWorld.elements[14];
        const distance = node.boundingVolume.box.distanceToPoint(cameraLocalPosition);
        return camera.preSSE * (node.geometricError / distance);
    }
    if (node.boundingVolume.sphere) {
        const cameraLocalPosition = camera.camera3D.position.clone();
        cameraLocalPosition.x -= node.matrixWorld.elements[12];
        cameraLocalPosition.y -= node.matrixWorld.elements[13];
        cameraLocalPosition.z -= node.matrixWorld.elements[14];
        const distance = node.boundingVolume.sphere.distanceToPoint(cameraLocalPosition);
        return camera.preSSE * (node.geometricError / distance);
    }
    return Infinity;
}

export function init3dTilesLayer(view, scheduler, layer) {
    return requestNewTile(view, scheduler, layer, layer.tileset.root).then(
            (tile) => {
                layer.object3d.add(tile);
                tile.updateMatrixWorld();
                layer.root = tile;
            });
}

function setDisplayed(node, display) {
    // The geometry of the tile is not in node, but in node.content
    // To change the display state, we change node.content.visible instead of
    // node.material.visible
    if (node.content) {
        node.content.visible = display;
    }
}

function markForDeletion(elt) {
    if (!elt.notVisibleSince) {
        elt.notVisibleSince = Date.now();
    }
    for (const child of elt.children.filter(n => n.layer == elt.layer)) {
        markForDeletion(child);
    }
}

export function process3dTilesNode(cullingTest, subdivisionTest) {
    return function _process3dTilesNodes(context, layer, node) {
        // early exit if parent's subdivision is in progress
        if (node.parent.pendingSubdivision && !node.parent.additiveRefinement) {
            node.visible = false;
            return undefined;
        }

        // do proper culling
        const isVisible = cullingTest ? (!cullingTest(node, context.camera)) : true;
        node.visible = isVisible;

        let returnValue;

        if (isVisible) {
            node.notVisibleSince = undefined;


            if (node.pendingSubdivision || subdivisionTest(context, layer, node)) {
                subdivideNode(context, layer, node);
                // display iff children aren't ready
                setDisplayed(node, node.pendingSubdivision || node.additiveRefinement);
                returnValue = node.children.filter(n => n.layer == layer.id);
            } else {
                setDisplayed(node, true);
            }

            if ((node.material === undefined || node.material.visible)) {
                for (const n of node.children.filter(n => n.layer == layer.id)) {
                    n.visible = false;
                    if (!node.pendingSubdivision) {
                        markForDeletion(n);
                    }
                }
            }

            return returnValue;
        }

        markForDeletion(node);

        return undefined;
    };
}

export function $3dTilesSubdivisionControl(context, layer, node) {
    const sse = computeNodeSSE(context.camera, node);
    return sse > layer.sseThreshold;
}
