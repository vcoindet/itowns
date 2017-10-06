/**
 * Generated On: 2017-12-09
 * Class: OrientedImage_Provider
 * Description: Provides Oriented Image data for immersive navigation
 */
import * as THREE from 'three';
import format from 'string-format';
import Extent from '../../Geographic/Extent';
// import Coordinates from '../../Geographic/Coordinates';
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
    layer.currentMat = null;
    layer.sensors = [];
    layer.networkOptions = { crossOrigin: '' };
    if (!(layer.extent instanceof Extent)) {
        layer.extent = new Extent(layer.projection, layer.extent);
    }
    var promises = [];

    promises.push(Fetcher.json(layer.calibrations, layer.networkOptions));
    promises.push(Fetcher.json(layer.orientations, layer.networkOptions));
    // todo: charger un tableau de panoInfo plutot que d'utiliser le GeoJSON2Feature
    return Promise.all(promises).then((res) => { layer.feature = GeoJSON2Feature.parse(layer.crsOut, res[1]); sensorsInit(res, layer); });
};

function loadOrientedImageData(oiInfo, layer, camera) {
    var promises = [];
    for (const sensor of layer.sensors) {
        var url = format(layer.images, { imageId: oiInfo.id, sensorId: sensor.id });
        promises.push(Fetcher.texture(url, layer.networkOptions));
    }
    return Promise.all(promises).then((res) => { updateMaterial(res, oiInfo, layer, camera); });
}

function getMatrix4FromRotation(Rot) {
    var M4 = new THREE.Matrix4();
    M4.elements[0] = Rot.elements[0];
    M4.elements[1] = Rot.elements[1];
    M4.elements[2] = Rot.elements[2];
    M4.elements[4] = Rot.elements[3];
    M4.elements[5] = Rot.elements[4];
    M4.elements[6] = Rot.elements[5];
    M4.elements[8] = Rot.elements[6];
    M4.elements[9] = Rot.elements[7];
    M4.elements[10] = Rot.elements[8];
    return M4;
}

function updateMatrixMaterial(oiInfo, layer, camera) {
    for (var i = 0; i < layer.shaderMat.uniforms.mvpp.value.length; ++i) {
        // compute a Matrix4 for the vertexShader
        // this Matrix4 convert position in the Camera View system to position on texture
        // CameraView -(mc2w)-> WorldPosition -(mw2p)-> PanoPosition -(mp2t)-> texture Position
        var mc2w = camera.matrixWorld;
        // rotation from geocentric to local vertical system
        const qGeoCentricToLocal = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(oiInfo.translation._values[0], oiInfo.translation._values[1], oiInfo.translation._values[2]).normalize());
        const euler = new THREE.Euler(
            oiInfo.pitch * Math.PI / 180,
            oiInfo.roll * Math.PI / 180,
            oiInfo.heading * Math.PI / 180 + Math.PI, 'ZXY');
            // -(oiInfo.heading * Math.PI / 180 - Math.PI * 0.5), 'ZXY');
        const qLocalToPano = new THREE.Quaternion().setFromEuler(euler);
        var centerPanoInWorl = new THREE.Vector4(
            oiInfo.translation._values[0],
            oiInfo.translation._values[1], oiInfo.translation._values[2],
            0);
        var mp2w = (new THREE.Matrix4().makeRotationFromQuaternion(qGeoCentricToLocal.multiply(qLocalToPano))).setPosition(centerPanoInWorl);
        var mw2p = new THREE.Matrix4().getInverse(mp2w);
        var mp2t = layer.sensors[i].mp2t.clone();
        layer.shaderMat.uniforms.mvpp.value[i] = (mp2t.multiply(mw2p)).multiply(mc2w);
    }
    // if (layer.view) layer.view.notifyChange(true);
}

function updateMaterial(textures, oiInfo, layer, camera) {
// function updateMaterial(textures, oiInfo, layer) {
    for (var i = 0; i < textures.length; ++i) {
        var oldTexture = layer.shaderMat.uniforms.texture.value[i];
        layer.shaderMat.uniforms.texture.value[i] = textures[i].texture;
        if (oldTexture) oldTexture.dispose();
    }
    updateMatrixMaterial(oiInfo, layer, camera);
}

// todo: deplacer les shaders dans le dossier shader
// Minimal vertex shader for one oriented image
function minimalTextureProjectiveVS(NbImages) {
    return [
        '#ifdef GL_ES',
        'precision  highp float;',
        '#endif',
        '#ifdef USE_LOGDEPTHBUF',
        '#define EPSILON 1e-6',
        '#ifdef USE_LOGDEPTHBUF_EXT',
        'varying float vFragDepth;',
        '#endif',
        'uniform float logDepthBufFC;',
        '#endif',
        `#define N ${NbImages}`,
        'uniform mat4 mvpp[N];',
        'varying vec4 texcoord[N];',
        'vec4 posView;',
        'void main() {',
        '   posView =  modelViewMatrix * vec4(position,1.);',
        '   for(int i=0; i<N; ++i) texcoord[i] = mvpp[i] * posView;',
        '   gl_Position = projectionMatrix * posView;',
        '#ifdef USE_LOGDEPTHBUF',
        '   gl_Position.z = log2(max( EPSILON, gl_Position.w + 1.0 )) * logDepthBufFC;',
        '#ifdef USE_LOGDEPTHBUF_EXT',
        '   vFragDepth = 1.0 + gl_Position.w;',
        '#else',
        '   gl_Position.z = (gl_Position.z - 1.0) * gl_Position.w;',
        '#endif',
        '#endif',
        '}',
    ].join('\n');
}

// // Minimal fragment shader for one oriented image
function minimalTextureProjectiveFS(NbImages, withDistort) {
    var mainLoop = [];
    let i;
    for (i = 0; i < NbImages; ++i) {
        mainLoop.push(`if(texcoord[${i}].z>0.) {`);
        mainLoop.push(`   p =  texcoord[${i}].xy/texcoord[${i}].z;`);
        if (withDistort) mainLoop.push(`  distort(p,distortion[${i}],pps[${i}]);`);
        mainLoop.push(`   d = borderfadeoutinv * getUV(p,size[${i}]);`);
        mainLoop.push('   if(d>0.) {');
        mainLoop.push(`       c = d*texture2D(texture[${i}],p);`);
        mainLoop.push('       color += c;');
        mainLoop.push('       if(c.a>0.) ++blend;');
        mainLoop.push('   }');
        mainLoop.push('}');
    }
    return [
        '#ifdef GL_ES',
        'precision  highp float;',
        '#endif',
        '#ifdef USE_LOGDEPTHBUF',
        '#define EPSILON 1e-6',
        '#ifdef USE_LOGDEPTHBUF_EXT',
        'varying float vFragDepth;',
        '#endif',
        'uniform float logDepthBufFC;',
        '#endif',
        `#define N ${NbImages}`,
        'varying vec4 texcoord[N];',
        'uniform sampler2D texture[N];',
        'uniform vec2      size[N];',
        (withDistort) ? '#define WITH_DISTORT' : '',
        '#ifdef WITH_DISTORT',
        'uniform vec2      pps[N];',
        'uniform vec4      distortion[N];',
        '#endif',
        'const float borderfadeoutinv = 0.02;',

        'float getUV(inout vec2 p, vec2 s)',
        '{',
        '   p.y = s.y-p.y;',
        '   vec2 d = min(p.xy,s-p.xy);',
        '   p/=s;',
        '   return min(d.x,d.y);',
        '}',

        '#ifdef WITH_DISTORT',
        'void distort(inout vec2 p, vec4 adist, vec2 apps)',
        '{',
        '   vec2 v = p - apps;',
        '   float v2 = dot(v,v);',
        '   if(v2>adist.w) p = vec2(-1.);',
        '   else p += (v2*(adist.x+v2*(adist.y+v2*adist.z)))*v;',
        '}',
        '#endif',

        'void main(void)',
        '{',
        '#if defined(USE_LOGDEPTHBUF) && defined(USE_LOGDEPTHBUF_EXT)',
        '   gl_FragDepthEXT = log2(vFragDepth) * logDepthBufFC * 0.5;',
        '#endif',
        '   vec4 color  = vec4(0.);',
        '   vec2 p;',
        '   vec4 c;',
        '   float d;',
        '   int blend = 0;',
        mainLoop.join('\n'),
        '   if (color.a > 0.0) color = color / color.a;',
        '   color.a = 1.;',
        '   gl_FragColor = color;',
        '} ',
    ].join('\n');
}

function sensorsInit(res, layer) {
    let i;
    for (i = 0; i < layer.feature.geometries[0].coordinates.length; ++i) {
        layer.feature.features[i].properties.properties.translation = layer.feature.geometries[0].coordinates[i];
    }

    var withDistort = false;
    for (const s of res[0]) {
        var sensor = {};
        sensor.id = s.id;
        var rotCamera2Pano = new THREE.Matrix3().fromArray(s.rotation);


        // var rotEspaceImage = new THREE.Matrix3().set(-1, 0, 0, 0, 1, 0, 0, 0, 1);
        // var rotTerrain = new THREE.Matrix3().set(0, 1, 0, 1, 0, 0, 0, 0, 1);

        // rotCamera2Pano = rotTerrain.clone().multiply(rotCamera2Pano.clone().multiply(rotEspaceImage));

        var centerCameraInPano = new THREE.Vector3().fromArray(s.position);
        var transPano2Camera = new THREE.Matrix4().makeTranslation(
            centerCameraInPano.x,
            centerCameraInPano.y,
            centerCameraInPano.z);
        // console.log(transPano2Camera);
        var projection = new THREE.Matrix3().fromArray(s.projection);
        var rotTexture2Pano = rotCamera2Pano.multiply(projection);
        var rotPano2Texture = rotTexture2Pano.clone().transpose();
        sensor.mp2t = getMatrix4FromRotation(rotPano2Texture).multiply(transPano2Camera);

        sensor.distortion = null;
        sensor.pps = null;
        if (s.distortion) {
            sensor.pps = new THREE.Vector2().fromArray(s.distortion.pps);
            var disto = new THREE.Vector3().fromArray(s.distortion.poly357);
            sensor.distortion = new THREE.Vector4(disto.x, disto.y, disto.z, s.distortion.limit * s.distortion.limit);
            withDistort = true;
        }
        sensor.size = new THREE.Vector2().fromArray(s.size);
        layer.sensors.push(sensor);
    }
    var U = {
        size: { type: 'v2v', value: [] },
        mvpp: { type: 'm4v', value: [] },
        texture: { type: 'tv', value: [] },
    };

    if (withDistort) {
        U.distortion = { type: 'v4v', value: [] };
        U.pps = { type: 'v2v', value: [] };
    }

    for (i = 0; i < layer.sensors.length; ++i) {
        U.size.value[i] = layer.sensors[i].size;
        U.mvpp.value[i] = new THREE.Matrix4();
        U.texture.value[i] = new THREE.Texture();
        if (withDistort) {
            U.distortion.value[i] = layer.sensors[i].distortion;
            U.pps.value[i] = layer.sensors[i].pps;
        }
    }

    // create the shader material for Three
    layer.shaderMat = new THREE.ShaderMaterial({
        uniforms: U,
        vertexShader: minimalTextureProjectiveVS(layer.sensors.length),
        fragmentShader: minimalTextureProjectiveFS(layer.sensors.length, withDistort),
        side: THREE.DoubleSide,
        transparent: true,
        // opacity: 0.5,
        // wireframe: true,
    });
    // loadOrientedImageData(layer.feature.features[0].properties.properties, layer);
}

OrientedImage_Provider.prototype.getNextPano = function getNextPano(layer) {
    var geom = layer.feature.geometries[0];
    var panoIndex = (layer.currentPano + 1) % layer.feature.features.length;
    var P = geom.coordinates[panoIndex];
    var cameraPosition = (new THREE.Vector3()).set(P._values[0], P._values[1], P._values[2]);
    return { position: cameraPosition };
};

OrientedImage_Provider.prototype.getPreviousPano = function getPreviousPano(layer) {
    var geom = layer.feature.geometries[0];
    var panoIndex = (layer.currentPano - 1) % layer.feature.features.length;
    var P = geom.coordinates[panoIndex];
    var cameraPosition = (new THREE.Vector3()).set(P._values[0], P._values[1], P._values[2]);
    return { position: cameraPosition };
};

OrientedImage_Provider.prototype.updateMaterial = function updateMaterial(camera, scene, layer) {
    var currentPos = camera.position.clone();
    var position = new THREE.Vector3(currentPos.x, currentPos.y, currentPos.z);

    // if necessary create the sphere
    if (!layer.sphere) {
        // On cree une sphere et on l'ajoute a la scene
        var geometry = new THREE.SphereGeometry(1, 32, 32);
        // var material = layer.shaderMat;
        var material = new THREE.MeshPhongMaterial({ color: 0x7777ff, side: THREE.DoubleSide, transparent: true, opacity: 0.5, wireframe: true });
        layer.sphere = new THREE.Mesh(geometry, material);
        layer.sphere.visible = true;
        layer.sphere.layer = layer.id;
        layer.sphere.name = 'immersiveSphere';
        scene.add(layer.sphere);
    }

    // sphere can be create before shaderMat
    // update the material to be sure
    if (layer.shaderMat) layer.sphere.material = layer.shaderMat;

    // look for the closest oriented image
    if (layer.feature && layer.feature.geometries[0])
    {
        var minDist = -1;
        var minIndice = -1;
        var geom = layer.feature.geometries[0];
        let indice = 0;
        for (const coordinate of geom.coordinates) {
            var vPano = new THREE.Vector3(coordinate._values[0], coordinate._values[1], coordinate._values[2]);
            var D = position.distanceTo(vPano);
            if ((minDist < 0) || (minDist > D)) {
                minDist = D;
                minIndice = indice;
            }
            ++indice;
        }
        if (layer.currentPano !== minIndice) {
            layer.currentPano = minIndice;
            var P = geom.coordinates[minIndice];
            layer.sphere.position.set(P._values[0], P._values[1], P._values[2]);
            layer.sphere.updateMatrixWorld();
            loadOrientedImageData(layer.feature.features[minIndice].properties.properties, layer, camera);
        }
        else {
            // update the uniforms
            updateMatrixMaterial(layer.feature.features[minIndice].properties.properties, layer, camera);
        }
    }
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
        var prop = [];
        var indicePano = [];
        let i = 0;
        for (const coordinate of geom.coordinates) {
            if (tile.extent.isPointInside(coordinate)) {
                sel.push([coordinate._values[0], coordinate._values[1], coordinate._values[2]]);
                prop.push(layer.feature.features[i].properties.properties);
                indicePano.push(i);
            }
            ++i;
        }
        if (sel.length) {
            // create THREE.Points with the orientedImage position
            const vertices = new Float32Array(3 * sel.length);
            let indice = 0;
            for (const v of sel) {
                vertices[indice] = v[0] - sel[0][0];
                vertices[indice + 1] = v[1] - sel[0][1];
                vertices[indice + 2] = v[2] - sel[0][2];
                indice += 3;
            }
            const bufferGeometry = new THREE.BufferGeometry();
            bufferGeometry.addAttribute('position', new THREE.BufferAttribute(vertices, 3));
            const P = new THREE.Points(bufferGeometry);
            P.position.set(sel[0][0], sel[0][1], sel[0][2]);
            P.updateMatrixWorld(true);
            return Promise.resolve(assignLayer(P, layer));
        }
    }
    return Promise.resolve();
};

export default OrientedImage_Provider;
