/* global itowns, document, renderer */
// # Simple Globe viewer

// Define initial camera position
var positionOnGlobe = { longitude: 2.351323, latitude: 48.856712, altitude: 5000000 };
var promises = [];
var miniView;
var minDistance = 10000000;
var maxDistance = 30000000;

// `viewerDiv` will contain iTowns' rendering area (`<canvas>`)
var viewerDiv = document.getElementById('viewerDiv');
var miniDiv = document.getElementById('miniDiv');

// Instanciate iTowns GlobeView*
var globeView = new itowns.GlobeView(viewerDiv, positionOnGlobe, { renderer: renderer });
function addLayerCb(layer) {
    return globeView.addLayer(layer);
}

// Dont' instance mini viewer if it's Test env
if (!renderer) {
    miniView = new itowns.GlobeView(miniDiv, positionOnGlobe, {
        // `limit globe' subdivision level:
        // we're don't need a precise globe model
        // since the mini globe will always be seen from a far point of view (see minDistance above)
        maxSubdivisionLevel: 2,
        // Don't instance default controls since miniview's camera will be synced
        // on the main view's one (see globeView.onAfterRender)
        noControls: true,
    });

    // Set a 0 alpha clear value (instead of the default '1')
    // because we want a transparent background for the miniglobe view to be able
    // to see the main view "behind"
    miniView.mainLoop.gfxEngine.renderer.setClearColor(0x000000, 0);

    // update miniview's camera with the globeView's camera position
    globeView.onAfterRender = function onAfterRender() {
        // clamp distance camera from globe
        var distanceCamera = globeView.camera.camera3D.position.length();
        var distance = Math.min(Math.max(distanceCamera * 1.5, minDistance), maxDistance);
        var camera = miniView.camera.camera3D;
        // Update target miniview's camera
        camera.position.copy(globeView.controls.moveTarget()).setLength(distance);
        camera.lookAt(globeView.controls.moveTarget());
        miniView.notifyChange(true);
    };

    // Add one imagery layer to the miniview
    itowns.Fetcher.json('./layers/JSONLayers/Ortho.json').then(function _(layer) { miniView.addLayer(layer); });
}

globeView.addEventListener(itowns.GLOBE_VIEW_EVENTS.GLOBE_INITIALIZED, function () {
    const epsg = '5514';
    itowns.Fetcher.json(`http://epsg.io/?q=${epsg}&format=json`).then(function (content) {
        const code = `EPSG:${epsg}`;
        if (!itowns.proj4.defs[code]) {
            itowns.proj4.defs(code, content.results[0].proj4);
        }

        const geoExtent = new itowns.Extent(
            'EPSG:4326',
                content.results[0].bbox[1],
                content.results[0].bbox[3],
                content.results[0].bbox[2],
                content.results[0].bbox[0]);
        const extent = geoExtent.as(code);
        console.log('New extent', extent);

        const epsgLayer = itowns.createPlanarLayer(extent.crs(), extent, {
            object3d: globeView.scene,
        });
        epsgLayer.noTextureColor = new itowns.THREE.Color(0xeedeae);
        epsgLayer.disableSkirt = true;
        itowns.View.prototype.addLayer.call(globeView, epsgLayer);

        globeView.controls.setCameraTargetGeoPosition(
            {longitude: geoExtent.center().longitude(), latitude: geoExtent.center().latitude()});
    });
});


promises.push(itowns.Fetcher.json('./layers/JSONLayers/Ortho.json').then(addLayerCb));

exports.view = globeView;

