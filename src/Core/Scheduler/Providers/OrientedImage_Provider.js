/**
 * Generated On: 2017-12-09
 * Class: OrientedImage_Provider
 * Description: Provides Oriented Image data for immersive navigation
 */
import * as THREE from 'three';
import Extent from '../../Geographic/Extent';
import Provider from './Provider';
import Fetcher from './Fetcher';
import CacheRessource from './CacheRessource';
import GeoJSON2Feature from '../../../Renderer/ThreeExtended/GeoJSON2Feature';

function OrientedImage_Provider() {
    this.cache = CacheRessource();
}

OrientedImage_Provider.prototype = Object.create(Provider.prototype);

OrientedImage_Provider.prototype.constructor = OrientedImage_Provider;

OrientedImage_Provider.prototype.preprocessDataLayer = function preprocessDataLayer(layer) {
    layer.format = layer.options.mimetype || 'json';

    layer.feature = null;
    layer.currentPano = -1;
    if (!(layer.extent instanceof Extent)) {
        layer.extent = new Extent(layer.projection, layer.extent);
    }
    var promises = [];
    promises.push(Fetcher.json(layer.calibration, layer.networkOptions));
    promises.push(Fetcher.json(layer.url, layer.networkOptions));
    return Promise.all(promises).then((res) => { layer.calibration = res[0]; layer.feature = GeoJSON2Feature.parse(layer.crsOut, res[1]); });
};

OrientedImage_Provider.prototype.tileInsideLimit = function tileInsideLimit(tile, layer) {
    return (layer.level === undefined || tile.level === layer.level) && layer.extent.intersect(tile.extent);
};

OrientedImage_Provider.prototype.executeCommand = function executeCommand(command) {
    const layer = command.layer;
    const tile = command.requester;
    const destinationCrs = command.view.referenceCrs;
    return this.getFeatures(destinationCrs, tile, layer, command).then(result => command.resolve(result));
};

function assignLayer(object, layer) {
    if (object) {
        object.layer = layer.id;
        object.layers.set(layer.threejsLayer);
        for (const c of object.children) {
            assignLayer(c, layer);
        }
        return object;
    }
}

// load data for a layer/tile/crs
OrientedImage_Provider.prototype.getFeatures = function getFeatures(crs, tile, layer) {
    if (layer.feature && layer.feature.geometries[0])
    {
        var geom = layer.feature.geometries[0];
        var sel = [];
        for (const coordinate of geom.coordinates) {
            if (tile.extent.isPointInside(coordinate)) {
                sel.push(coordinate._values[0]);
                sel.push(coordinate._values[1]);
                sel.push(coordinate._values[2]);
            }
        }
        if (sel.length) {
            const geometry = new THREE.BufferGeometry();
            const vertices = new Float32Array(sel.length);
            let indice = 0;
            for (const v of sel) {
                vertices[indice] = v - sel[indice % 3];
                indice += 1;
            }
            geometry.addAttribute('position', new THREE.BufferAttribute(vertices, 3));
            const P = new THREE.Points(geometry);
            P.position.set(sel[0], sel[1], sel[2]);
            return Promise.resolve(assignLayer(P, layer));
        }
    }
    return Promise.resolve();
};

// Order : lat, long or long, lat
OrientedImage_Provider.prototype.getPointOrder = function getPointOrder(crs) {
    if (this.pointOrder[crs]) {
        return this.pointOrder[crs];
    }

    var pointOrder = { lat: 0, long: 1 };

    if (crs.type == 'EPSG' && crs.properties.code == '4326') {
        pointOrder.long = 0;
        pointOrder.lat = 1;
        return pointOrder;
    } else if (crs.type == 'name') {
        if (crs.properties.name) {
            var regExpEpsg = new RegExp(/^urn:[x-]?ogc:def:crs:EPSG:(\d*.?\d*)?:\d{4}/);
            if (regExpEpsg.test(crs.properties.name)) {
                return pointOrder;
            }
            else {
                var regExpOgc = new RegExp(/^urn:[x-]?ogc:def:crs:OGC:(\d*.?\d*)?:(CRS)?(WSG)?\d{0,2}/);
                if (regExpOgc.test(crs.properties.name)) {
                    pointOrder.long = 0;
                    pointOrder.lat = 1;
                    return pointOrder;
                }
            }
        }
    }
};

export default OrientedImage_Provider;
