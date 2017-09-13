import * as THREE from 'three';
import LayerUpdateState from '../Core/Layer/LayerUpdateState';
import { CancelledCommandException } from '../Core/Scheduler/Scheduler';
import ObjectRemovalHelper from './ObjectRemovalHelper';

function updateOrientedImageData(context, layer, node) {
    if (!node.parent && node.children.length) {
        // if node has been removed dispose three.js resource
        ObjectRemovalHelper.removeChildrenAndCleanupRecursively(layer.id, node);
        return;
    }

    if (!node.visible) {
        return;
    }

    const features = node.children.filter(n => n.layer == layer.id);
    if (features.length > 0) {
        return features;
    }

    if (!layer.tileInsideLimit(node, layer)) {
        return;
    }

    if (node.layerUpdateState[layer.id] === undefined) {
        node.layerUpdateState[layer.id] = new LayerUpdateState();
    }

    const ts = Date.now();

    if (!node.layerUpdateState[layer.id].canTryUpdate(ts)) {
        return;
    }

    node.layerUpdateState[layer.id].newTry();

    const command = {
        layer,
        view: context.view,
        threejsLayer: layer.threejsLayer,
        requester: node,
    };

    context.scheduler.execute(command).then((result) => {
        // if request return empty json, WFS_Provider.getFeatures return undefined
        if (result) {
            node.layerUpdateState[layer.id].success();
            if (!node.parent) {
                ObjectRemovalHelper.removeChildrenAndCleanupRecursively(layer.id, result);
                return;
            }
            // result coordinayes are in Worl system
            // update position to be relative to the tile
            result.position.sub(node.extent.center().as(context.view.referenceCrs).xyz());
            result.layer = layer.id;
            node.add(result);
            node.updateMatrixWorld();
        } else {
            node.layerUpdateState[layer.id].failure(1, true);
        }
    },
    (err) => {
        if (err instanceof CancelledCommandException) {
            node.layerUpdateState[layer.id].success();
        } else if (err instanceof SyntaxError) {
            node.layerUpdateState[layer.id].failure(0, true);
        } else {
            node.layerUpdateState[layer.id].failure(Date.now());
            setTimeout(node.layerUpdateState[layer.id].secondsUntilNextTry() * 1000,
                () => {
                    context.view.notifyChange(false);
                });
        }
    });
}

function updateMateriel(context, layer) {
    // check the closest orientedImage
    var currentPos = context.camera.camera3D.position.clone();
    var vCurrentPos = new THREE.Vector3(currentPos.x, currentPos.y, currentPos.z);

    var minDist = -1;
    var minIndice = -1;
    if (layer.feature && layer.feature.geometries[0])
    {
        var geom = layer.feature.geometries[0];
        let indice = 0;
        for (const coordinate of geom.coordinates) {
            var vPano = new THREE.Vector3(coordinate._values[0], coordinate._values[1], coordinate._values[2]);
            var D = vCurrentPos.distanceTo(vPano);
            if ((minDist < 0) || (minDist > D)) {
                minDist = D;
                minIndice = indice;
            }
            ++indice;
        }
    }
    if (layer.currentPano !== minIndice) {
        layer.currentPano = minIndice;
        console.log('Changement de pano : ', layer.currentPano, ' distance : ', minDist);
    }
}

export default {
    update() {
        return function _(context, layer, node) {
            // First Load new OrientedImage MTD
            updateOrientedImageData(context, layer, node);

            // Then, Update Shader/Material
            updateMateriel(context, layer, node);
        };
    },

};
