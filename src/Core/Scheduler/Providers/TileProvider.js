/*
 * To change this license header, choose License Headers in Project Properties.
 * To change this template file, choose Tools | Templates
 * and open the template in the editor.
 */

// import { Vector3 } from 'three';
import Provider from './Provider';
import TileGeometry from '../../TileGeometry';
import TileMesh from '../../TileMesh';
import Extent from '../../Geographic/Extent';
import { CancelledCommandException } from '../Scheduler';

function TileProvider() {
    Provider.call(this, null);
    this.cacheGeometry = [];
}

TileProvider.prototype = Object.create(Provider.prototype);

TileProvider.prototype.constructor = TileProvider;

TileProvider.prototype.executeCommand = function executeCommand(command) {
    const extent = command.extent;
    if (command.requester &&
        !command.requester.material) {
        // request has been deleted
        return Promise.reject(new CancelledCommandException(command));
    }

    const parent = command.requester;
    const south = extent.south();
    const level = (command.level === undefined) ? (parent.level + 1) : command.level;

    if (!this.cacheGeometry[level]) {
        this.cacheGeometry[level] = [];
    }
    if (!this.cacheGeometry[level][south]) {
        const deferedPromise = {};
        deferedPromise.promise = new Promise((resolve) => {
            deferedPromise.resolve = resolve;
        });
        this.cacheGeometry[level][south] = deferedPromise;
        const ext = new Extent(extent.crs(), 0, Math.abs(extent.west() - extent.east()), extent.south(), extent.north());
        ext._internalStorageUnit = 0;
        const paramsGeometry = {
            extent: ext,
            level,
            segment: 16,
            materialOptions: command.layer.materialOptions,
            disableSkirt: command.layer.disableSkirt,
        };
        this.cacheGeometry[level][south].resolve(new TileGeometry(paramsGeometry, command.layer.builder));
    }

    // build tile
    var params = {
        extent,
        level,
        segment: 16,
        materialOptions: command.layer.materialOptions,
        disableSkirt: command.layer.disableSkirt,
    };

    command.layer.builder.Center(params);

    return this.cacheGeometry[level][extent.south()].promise.then((geometry) => {
        var tile = new TileMesh(geometry, params);
        tile.layer = command.layer.id;
        tile.layers.set(command.threejsLayer);

        const center = params.center.clone();

        if (parent) {
            parent.worldToLocal(center);
        }

        tile.position.copy(center);
        const rotationZ = parent ? (extent.west() - parent.extent.west()) : extent.west();
        tile.rotation.set(0, 0, rotationZ, 'XYZ');
        tile.setVisibility(false);
        tile.updateMatrix();

        if (parent) {
            tile.setBBoxZ(parent.OBB().z.min, parent.OBB().z.max);
        } else if (command.layer.materialOptions && command.layer.materialOptions.useColorTextureElevation) {
            tile.setBBoxZ(command.layer.materialOptions.colorTextureElevationMinZ, command.layer.materialOptions.colorTextureElevationMaxZ);
        }

        return Promise.resolve(tile);
    });
};

export default TileProvider;
