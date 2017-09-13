/* global itowns, document, renderer */
// # Loading gpx file

// Define initial camera position
var positionOnGlobe = { longitude: 2.334242, latitude: 48.850167, altitude: 100 };

// `viewerDiv` will contain iTowns' rendering area (`<canvas>`)
var viewerDiv = document.getElementById('viewerDiv');

// Instanciate iTowns GlobeView*
var globeView = new itowns.GlobeView(viewerDiv, positionOnGlobe, { renderer: renderer });

var promises = [];

function addLayerCb(layer) {
    return globeView.addLayer(layer);
}
// Add one imagery layer to the scene
// This layer is defined in a json file but it could be defined as a plain js
// object. See Layer* for more info.
promises.push(itowns.Fetcher.json('./layers/JSONLayers/Ortho.json').then(addLayerCb));
// Add two elevation layers.
// These will deform iTowns globe geometry to represent terrain elevation.
promises.push(itowns.Fetcher.json('./layers/JSONLayers/WORLD_DTM.json').then(addLayerCb));
promises.push(itowns.Fetcher.json('./layers/JSONLayers/IGN_MNT_HIGHRES.json').then(addLayerCb));

exports.view = globeView;

globeView.addLayer({
    update: itowns.OrientedImageProcessing.update(),
    // update: itowns.FeatureProcessing.update(),
    url: 'http://localhost:8080/examples/layers/panoramicsMetaData3D-4326.geojson',
    protocol: 'orientedimage',
    // version: '2.0.0',
    id: 'demo_orientedImage',
    // typeName: 'tcl_sytral.tcllignebus',
    level: 2,
    projection: 'EPSG:4326',
    crsOut: globeView.referenceCrs,
    options: {
        mimetype: 'geojson',
    },
}, globeView.tileLayer);
