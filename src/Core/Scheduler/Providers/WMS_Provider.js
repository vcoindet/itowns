/**
 * Generated On: 2015-10-5
 * Class: WMS_Provider
 * Description: Provides data from a WMS stream
 */


import * as THREE from 'three';
import Extent from '../../Geographic/Extent';
import OGCWebServiceHelper from './OGCWebServiceHelper';

/**
 * Return url wmts MNT
 * @param {String} options.url: service base url
 * @param {String} options.layer: requested data layer
 * @param {String} options.format: image format (default: format/jpeg)
 */
function WMS_Provider() {
}

WMS_Provider.prototype.url = function url(bbox, layer) {
    const box = bbox.as(layer.projection);
    const w = box.west();
    const s = box.south();
    const e = box.east();
    const n = box.north();

    const bboxInUnit = layer.axisOrder === 'swne' ?
        `${s},${w},${n},${e}` :
        `${w},${s},${e},${n}`;

    return layer.customUrl.replace('%bbox', bboxInUnit);
};

WMS_Provider.prototype.preprocessDataLayer = function preprocessDataLayer(layer) {
    if (!layer.name) {
        throw new Error('layer.name is required.');
    }
    if (!layer.extent) {
        throw new Error('layer.extent is required');
    }
    if (!layer.projection) {
        throw new Error('layer.projection is required');
    }

    if (!(layer.extent instanceof Extent)) {
        layer.extent = new Extent(layer.projection, layer.extent);
    }

    if (!layer.options.zoom) {
        layer.options.zoom = { min: 0, max: 21 };
    }

    layer.axisOrder = layer.axisOrder || 'swne';
    layer.format = layer.options.mimetype || 'image/png';
    layer.width = layer.heightMapWidth || 256;
    layer.version = layer.version || '1.3.0';
    layer.style = layer.style || '';
    layer.transparent = layer.transparent || false;

    layer.customUrl = `${layer.url
                  }?SERVICE=WMS&REQUEST=GetMap&LAYERS=${layer.name
                  }&VERSION=${layer.version
                  }&STYLES=${layer.style
                  }&FORMAT=${layer.format
                  }&TRANSPARENT=${layer.transparent
                  }&BBOX=%bbox` +
                  `&CRS=${layer.projection
                  }&WIDTH=${layer.width
                  }&HEIGHT=${layer.width}`;
};

WMS_Provider.prototype.tileInsideLimit = function tileInsideLimit(tile, layer, targetLevel) {
    // return tile.level >= layer.options.zoom.min && tile.level <= layer.options.zoom.max && layer.extent.intersect(tile.extent);
    for (const coord of tile.getCoordsForLayer(layer)) {
        let c = coord;
        // override
        if (targetLevel < c.zoom) {
            c = OGCWebServiceHelper.WMTS_WGS84Parent(coord, targetLevel);
        }
        if (c.zoom < layer.options.zoom.min || c.zoom > layer.options.zoom.max) {
            return false;
        }
    }
    return true;
};


WMS_Provider.prototype.getColorTexture = function getColorTexture(coordWMTS, layer, tile) {
    // if (!this.tileInsideLimit(tile, layer)) {
    //     return Promise.reject(`Tile '${tile}' is outside layer bbox ${layer.extent}`);
    // }
    if (tile.material === null) {
        return Promise.resolve();
    }

    const url = this.url(coordWMTS, layer, tile);

    return OGCWebServiceHelper.getColorTextureByUrl(url, layer.networkOptions).then((texture) => {
        const result = {};
        result.texture = texture;
        result.texture.coords = coordWMTS;
        result.pitch = new THREE.Vector3(0, 0, 1);

        return result;
    });
};

WMS_Provider.prototype.executeCommand = function executeCommand(command) {
    const tile = command.requester;

    const layer = command.layer;
    const supportedFormats = {
        'image/png': this.getColorTextures.bind(this),
        'image/jpg': this.getColorTextures.bind(this),
        'image/jpeg': this.getColorTextures.bind(this),
    };

    const func = supportedFormats[layer.format];

    if (func) {
        return func(tile, layer);
    } else {
        return Promise.reject(new Error(`Unsupported mimetype ${layer.format}`));
    }
};

WMS_Provider.prototype.getColorTextures = function getColorTextures(tile, layer) {
    if (tile.material === null) {
        return Promise.resolve();
    }
    const promises = [];
    const bcoord = tile.getCoordsForLayer(layer);

    for (const coordWMTS of bcoord) {
        promises.push(this.getColorTexture(coordWMTS, layer, tile));
    }

    return Promise.all(promises);
};

export default WMS_Provider;
