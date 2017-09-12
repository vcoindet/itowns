/**
 * Generated On: 2017-12-09
 * Class: OrientedImage_Provider
 * Description: Provides Oriented Image data for immersive navigation
 */

import Extent from '../../Geographic/Extent';
import Provider from './Provider';
import Fetcher from './Fetcher';
import CacheRessource from './CacheRessource';
import GeoJSON2Feature from '../../../Renderer/ThreeExtended/GeoJSON2Feature';
import Feature2Mesh from '../../../Renderer/ThreeExtended/Feature2Mesh';

function OrientedImage_Provider() {
    this.cache = CacheRessource();
    // this.pointOrder = new Map();
}

OrientedImage_Provider.prototype = Object.create(Provider.prototype);
OrientedImage_Provider.prototype.constructor = OrientedImage_Provider;

OrientedImage_Provider.prototype.preprocessDataLayer = function preprocessDataLayer(layer) {
    /*
    if (!layer.typeName) {
        throw new Error('layer.typeName is required.');
    }
    */

    layer.format = layer.options.mimetype || 'json';
    layer.crs = layer.projection || 'EPSG:4326';
    if (!(layer.extent instanceof Extent)) {
        layer.extent = new Extent(layer.projection, layer.extent);
    }
};


OrientedImage_Provider.prototype.tileInsideLimit = function tileInsideLimit(tile, layer) {
    return (layer.level === undefined || tile.level === layer.level) && layer.extent.intersect(tile.extent);
};

OrientedImage_Provider.prototype.executeCommand = function executeCommand(command) {
    console.log('executeCommand');
    const layer = command.layer;
    const tile = command.requester;
    const destinationCrs = command.view.referenceCrs;

    // TODO : support xml, gml2
    const supportedFormats = {
        json: this.getFeatures.bind(this),
        geojson: this.getFeatures.bind(this),
    };

    const func = supportedFormats[layer.format];
    if (func) {
        return func(destinationCrs, tile, layer, command).then(result => command.resolve(result));
    } else {
        return Promise.reject(new Error(`Unsupported mimetype ${layer.format}`));
    }
};

function assignLayer(object, layer) {
    console.log('assignLayer');
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
    console.log('getFeatures');
    if (!layer.tileInsideLimit(tile, layer) || tile.material === null) {
        return Promise.resolve();
    }

    // in this first version there is only one constant url in geoJson for all orientedImage in the layer
    const url = layer.url;
    const result = {};

    console.log('url:');
    console.log(url);
    result.feature = this.cache.getRessource(url);

    console.log('result.feature:');
    console.log(result.feature);

    if (result.feature !== undefined) {
        return Promise.resolve(result);
    }
    return Fetcher.json(url, layer.networkOptions).then(geojson => assignLayer(Feature2Mesh.convert(GeoJSON2Feature.parse(crs, geojson, tile.extent)), layer));
};

// Order : lat, long or long, lat
OrientedImage_Provider.prototype.getPointOrder = function getPointOrder(crs) {
    console.log('getPointOrder');
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
