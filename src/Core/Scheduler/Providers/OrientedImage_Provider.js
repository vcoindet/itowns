/**
 * Generated On: 2017-12-09
 * Class: OrientedImage_Provider
 * Description: Provides Oriented Image data for immersive navigation
 */
import * as THREE from 'three';
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

    promises.push(Fetcher.json(layer.calibration, layer.networkOptions));
    promises.push(Fetcher.json(layer.url, layer.networkOptions));
    // todo: charger un tableau de panoInfo plutot que d'utiliser le GeoJSON2Feature
    return Promise.all(promises).then((res) => { layer.feature = GeoJSON2Feature.parse(layer.crsOut, res[1]); sensorsInit(res, layer); });
};

function loadOrientedImageData(oiInfo, layer, camera) {
    var promises = [];
    // todo: ajouter l'url de images dans les info du layer
    // todo: mettre a jour le fichier des mtd de pano pour corriger la syntaxe de l'url
    // var url = `http://www.itowns-project.org/itowns-sample-data/images/140616/${oiInfo.filename}.jpg`;
    var url = `http://localhost:8080/LaVillette/images_512/${oiInfo.id}_00.jpg`;
    for (const sensor of layer.sensors) {
        var url2 = url.replace('_00.', `_${sensor.id}.`);
        promises.push(Fetcher.texture(url2, layer.networkOptions));
    }
    return Promise.all(promises).then((res) => { updateMaterial(res, oiInfo, layer, camera); });
}

function updateMatrixMaterial(oiInfo, layer, camera) {
    for (var i = 0; i < layer.shaderMat.uniforms.mvpp.value.length; ++i) {
        // version avec coord view dans le shader
        // matrixWorld: The global or world transform of the object
        // modelViewMatrix: is the object's matrixWorld pre-multiplied by the camera's matrixWorldInverse.
        // matrixWorldInverse: The view matrix - the inverse of the Camera's matrixWorld.
        var M = layer.sensors[i].matrix.clone().transpose();
        var M4 = new THREE.Matrix4();
        M4.elements[0] = M.elements[0];
        M4.elements[1] = M.elements[1];
        M4.elements[2] = M.elements[2];
        M4.elements[4] = M.elements[3];
        M4.elements[5] = M.elements[4];
        M4.elements[6] = M.elements[5];
        M4.elements[8] = M.elements[6];
        M4.elements[9] = M.elements[7];
        M4.elements[10] = M.elements[8];
        const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(oiInfo.translation._values[0], oiInfo.translation._values[1], oiInfo.translation._values[2]).normalize());
        // // with sbet export for iTowns v1
        const euler = new THREE.Euler(
            oiInfo.pitch * Math.PI / 180,
            -oiInfo.roll * Math.PI / 180,
            -(oiInfo.heading * Math.PI / 180 - Math.PI * 0.5), 'ZXY');
        const cap = new THREE.Quaternion().setFromEuler(euler);
        quaternion.multiply(cap);
        var rot = new THREE.Matrix4().makeRotationFromQuaternion(quaternion);
        var translation = new THREE.Vector4(oiInfo.translation._values[0], oiInfo.translation._values[1], oiInfo.translation._values[2], 0);
        rot.setPosition(translation);
        // a ce stade rot est identique a la matrixWorld de la sphere
        // rot = new THREE.Matrix4().multiplyMatrices(camera.matrixWorld, rot);
        rot = new THREE.Matrix4().multiplyMatrices(M4, new THREE.Matrix4().getInverse(rot));
        rot = new THREE.Matrix4().multiplyMatrices(rot, camera.matrixWorld);
        layer.shaderMat.uniforms.mvpp.value[i] = rot.clone();
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
        '   color.a = 0.75;',
        '   gl_FragColor = color;',
        '} ',
    ].join('\n');
}

// http://fr.wikipedia.org/wiki/Methode_de_Cardan  Thanks Bredif
// function cardan_cubic_roots(a, b, c, d) {
//     if (a === 0) return quadratic_roots(b, c, d);
//     var vt = -b / (3 * a);
//     var a2 = a * a;
//     var b2 = b * b;
//     var a3 = a * a2;
//     var b3 = b * b2;
//     var p = c / a - b2 / (3 * a2);
//     var q = b3 / (a3 * 13.5) + d / a - b * c / (3 * a2);
//     if (p === 0) {
//         var x = cubic_root(-q) + vt;
//         return [x, x, x];
//     }
//     var p3_4_27 = p * p * p * 4 / 27;
//     var del = q * q + p3_4_27;
//     if (del > 0) {
//         var sqrt_del = Math.sqrt(del);
//         var u = cubic_root((-q + sqrt_del) / 2);
//         var v = cubic_root((-q - sqrt_del) / 2);
//         return [u + v + vt];
//     }
//     else if (del === 0) {
//         var z0 = 3 * q / p;
//         var x0 = vt + z0;
//         var x12 = vt - z0 * 0.5;
//         return [x0, x12, x12];
//     }
//     else {
//         var kos = Math.acos(-q / Math.sqrt(p3_4_27));
//         var r = 2 * Math.sqrt(-p / 3);
//         return [r * Math.cos(kos / 3) + vt, r * Math.cos((kos + Math.PI) / 3) + vt, r * Math.cos((kos + 2 * Math.PI) / 3) + vt];
//     }
// }

// function quadratic_roots(a, b, c) {
//     var delta = b * b - 4 * a * c;
//     if (delta < 0) return [];
//     var x0 = -b / (2 * a);
//     if (delta === 0) return [x0];
//     var sqr_delta_2a = Math.sqrt(delta) / (2 * a);
//     return [x0 - sqr_delta_2a, x0 + sqr_delta_2a];
// }

// function sgn(x) {
//     return (x > 0) - (x < 0);
// }

// function cubic_root(x) {
//     return sgn(x) * Math.pow(Math.abs(x), 1 / 3);
// }

// function getDistortion_r2max(disto) {
//     // returned the square of the smallest positive root of the derivativeof the distortion polynomial
//     // which tells where the distortion might no longer be bijective.
//     var roots = cardan_cubic_roots(7 * disto.z, 5 * disto.y, 3 * disto.x, 1);
//     var imax = -1;
//     for (var i in roots) {
//         if (roots[i] > 0 && (imax === -1 || roots[imax] > roots[i])) imax = i;
//         if (imax === -1) return Infinity; // no roots : all is valid !
//     }
//     return roots[imax];
// }

function sensorsInit(res, layer) {
    // var itownsWay = new THREE.Matrix3().set(0, -1, 0, 0, 0, -1, 1, 0, 0);
    // var photogram_JMM = new THREE.Matrix3().set(0, 0, -1, -1, 0, 0, 0, 1, 0);
    // var photgram_image = new THREE.Matrix3().set(1, 0, 0, 0, -1, 0, 0, 0, -1);
    // var ori0 = new THREE.Matrix3().set(0, -1, 0, 1, 0, 0, 0, 0, 1);
    // var ori1 = new THREE.Matrix3().set(0, 1, 0, -1, 0, 0, 0, 0, 1);
    // var ori2 = new THREE.Matrix3().set(-1, 0, 0, 0, -1, 0, 0, 0, 1);
    // var ori3 = new THREE.Matrix3().set(1, 0, 0, 0, 1, 0, 0, 0, 1);
    // console.log(layer.feature.features);
    // console.log(layer.feature.geometries[0].coordinates);
    let i;
    for (i = 0; i < layer.feature.geometries[0].coordinates.length; ++i) {
        layer.feature.features[i].properties.properties.translation = layer.feature.geometries[0].coordinates[i];
    }

    for (const s of res[0]) {
        var sensor = {};
        sensor.id = s.id;
        var rotation = new THREE.Matrix3().fromArray(s.rotation);
        // var orientationCapteur = null;
        // switch (s.orientation) {
        //     case 0: orientationCapteur = ori0; break;
        //     case 1: orientationCapteur = ori1; break;
        //     case 2: orientationCapteur = ori2; break;
        //     case 3: orientationCapteur = ori3; break;
        //     default: orientationCapteur = null;
        // }
        // rotation = new THREE.Matrix3().multiplyMatrices(rotation.clone(), photogram_JMM.clone());
        // rotation = new THREE.Matrix3().multiplyMatrices(rotation.clone(), orientationCapteur.clone());
        // rotation = new THREE.Matrix3().multiplyMatrices(rotation.clone(), photgram_image.clone());
        // rotation = new THREE.Matrix3().multiplyMatrices(itownsWay, rotation.clone());
        // sensor.sommet = new THREE.Vector3().fromArray(s.position);
        // sensor.sommet.applyMatrix3(itownsWay);
        sensor.projection = new THREE.Matrix3().fromArray(s.projection);
        sensor.matrix = new THREE.Matrix3().multiplyMatrices(rotation, sensor.projection);
        // sensor.distortion = null;
        // sensor.pps = null;
        // if (s.distortion) {
        //     sensor.pps = new THREE.Vector2().fromArray(s.distortion.pps);
        //     var disto = new THREE.Vector3().fromArray(s.distortion.poly357);
        //     var r2max = getDistortion_r2max(disto);
        //     sensor.distortion = new THREE.Vector4(disto.x, disto.y, disto.z, r2max);
        // }
        sensor.size = new THREE.Vector2().fromArray(s.size);
        layer.sensors.push(sensor);
    }
    var U = {
        size: { type: 'v2v', value: [] },
        mvpp: { type: 'm4v', value: [] },
        texture: { type: 'tv', value: [] },
        // distortion: { type: 'v4v', value: [] },
        // pps: { type: 'v2v', value: [] },
    };

    for (i = 0; i < layer.sensors.length; ++i) {
        U.size.value[i] = layer.sensors[i].size;
        U.mvpp.value[i] = new THREE.Matrix4();
        U.texture.value[i] = new THREE.Texture();
    }

    // create the shader material for Three
    layer.shaderMat = new THREE.ShaderMaterial({
        uniforms: U,
        vertexShader: minimalTextureProjectiveVS(layer.sensors.length),
        fragmentShader: minimalTextureProjectiveFS(layer.sensors.length),
        side: THREE.DoubleSide,
        transparent: true,
        // opacity: 0.5,
        // wireframe: true,
    });
    // loadOrientedImageData(layer.feature.features[0].properties.properties, layer);
}

OrientedImage_Provider.prototype.updateMaterial = function updateMaterial(camera, scene, layer) {
    var currentPos = camera.position.clone();
    var position = new THREE.Vector3(currentPos.x, currentPos.y, currentPos.z);

    // if necessary create the sphere
    if (!layer.sphere) {
        // On cree une sphere et on l'ajoute a la scene
        var geometry = new THREE.SphereGeometry(30, 32, 32);
        // var material = layer.shaderMat;
        var material = new THREE.MeshPhongMaterial({ color: 0x7777ff, side: THREE.DoubleSide, transparent: true, opacity: 0.5, wireframe: true });
        layer.sphere = new THREE.Mesh(geometry, material);
        layer.sphere.visible = true;
        layer.sphere.layer = layer.id;
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
