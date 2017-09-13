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
    //version: '2.0.0',
    id: 'demo_orientedImage',
    //typeName: 'tcl_sytral.tcllignebus',
    level: 2,
    projection: 'EPSG:4326',
    crsOut: globeView.referenceCrs,

    /*extent: {
        west: 651100.0,
        east: 651200.0,
        south: 6861300.0,
        north: 6861400.0,
    },*/
    options: {
        mimetype: 'geojson',
    },
}, globeView.tileLayer);




/*
var extent;
var viewerDiv;
var view;

// Define projection that we will use (taken from https://epsg.io/3946, Proj4js section)
itowns.proj4.defs('EPSG:3946',
    '+proj=lcc +lat_1=45.25 +lat_2=46.75 +lat_0=46 +lon_0=3 +x_0=1700000 +y_0=5200000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');

// Define geographic extent: CRS, min/max X, min/max Y
extent = new itowns.Extent(
    'EPSG:3946',
    1837816.94334, 1847692.32501,
    5170036.4587, 5178412.82698);

// `viewerDiv` will contain iTowns' rendering area (`<canvas>`)
viewerDiv = document.getElementById('viewerDiv');

// Instanciate PlanarView*
view = new itowns.PlanarView(viewerDiv, extent, { renderer: renderer });
view.tileLayer.disableSkirt = true;

// Add an WMS imagery layer (see WMS_Provider* for valid options)
view.addLayer({
    url: 'https://download.data.grandlyon.com/wms/grandlyon',
    networkOptions: { crossOrigin: 'anonymous' },
    type: 'color',
    protocol: 'wms',
    version: '1.3.0',
    id: 'wms_imagery',
    name: 'Ortho2009_vue_ensemble_16cm_CC46',
    projection: 'EPSG:3946',
    transparent: false,
    extent: extent,
    axisOrder: 'wsen',
    options: {
        mimetype: 'image/jpeg',
    },
});

view.camera.camera3D.position.set(1839739, 5171618, 910);
view.camera.camera3D.lookAt(new itowns.THREE.Vector3(1840839, 5172718, 0));

// eslint-disable-next-line no-new
new itowns.FirstPersonControls(view, { focusOnClick: true, moveSpeed: 1000 });

// Request redraw
view.notifyChange(true);

function colorFunctionPoint(layer, node, featureCollection) {
    var i;
    var featureProperties;
    var rgb;
    var colors = [];

    for (i = 0; i < featureCollection.features.length; i++) {
        // featureProperties = featureCollection.features[i].properties;
        // rgb = featureProperties.properties.couleur.split(' ');
        colors.push(new itowns.THREE.Color(1, 1, 1));
    }

    itowns.FeatureProcessing.assignColorsToFeatureCollection(
        featureCollection, featureCollection.children[0], colors);

    featureCollection.children[0].material.linewidth = 5;
}

view.addLayer({
    update: itowns.FeatureProcessing.update(colorFunctionPoint),
    url: 'layer/panoramicsMetaData.geojson',
    protocol: 'orientedimage',
    //version: '2.0.0',
    id: 'demo_orientedImage',
    //typeName: 'tcl_sytral.tcllignebus',
    level: 2,
    projection: 'EPSG:2154',
    extent: {
        west: 651100.0,
        east: 651200.0,
        south: 6861300.0,
        north: 6861400.0,
    },
    options: {
        mimetype: 'geojson',
    },
}, view.tileLayer);


exports.view = view;
*/
