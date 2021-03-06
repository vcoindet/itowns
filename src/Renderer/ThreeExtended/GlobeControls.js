// This set of controls performs orbiting, dollying (zooming), and panning. It maintains
// the "up" direction as +Y, unlike the TrackballControls. Touch on tablet and phones is
// supported.
//
//    Orbit - left mouse / touch: one finger move
//    Zoom - middle mouse, or mousewheel / touch: two finger spread or squish
//    Pan - right mouse, or arrow keys / touch: three finter swipe

import * as THREE from 'three';
import Sphere from '../../Core/Math/Sphere';
import AnimationPlayer, { Animation, AnimatedExpression } from '../../Core/AnimationPlayer';
import Coordinates, { C } from '../../Core/Geographic/Coordinates';
import { computeTileZoomFromDistanceCamera, computeDistanceCameraFromTileZoom } from '../../Process/GlobeTileProcessing';

// TODO:
// Recast touch for globe
// Fix target problem with pan and panoramic (when target isn't on globe)
// Fix problem with space

// FIXME:
// when move globe in damping orbit, there isn't move!!

const CONTROL_STATE = {
    NONE: -1,
    ORBIT: 0,
    DOLLY: 1,
    PAN: 2,
    TOUCH_ROTATE: 3,
    TOUCH_DOLLY: 4,
    TOUCH_PAN: 5,
    MOVE_GLOBE: 6,
    PANORAMIC: 7,
};

// The control's keys
const CONTROL_KEYS = {
    LEFT: 37,
    UP: 38,
    RIGHT: 39,
    BOTTOM: 40,
    SPACE: 32,
    SHIFT: 16,
    CTRL: 17,
    S: 83,
};

// TODO: can be optimize for some uses
var presiceSlerp = function presiceSlerp(qb, t) {
    if (t === 0) {
        return this;
    }

    if (t === 1) {
        return this.copy(qb);
    }

    const x = this._x;
    const y = this._y;
    const z = this._z;
    const w = this._w;

    // http://www.euclideanspace.com/maths/algebra/realNormedAlgebra/quaternions/slerp/

    var cosHalfTheta = w * qb._w + x * qb._x + y * qb._y + z * qb._z;

    if (cosHalfTheta < 0) {
        this._w = -qb._w;
        this._x = -qb._x;
        this._y = -qb._y;
        this._z = -qb._z;

        cosHalfTheta = -cosHalfTheta;
    } else {
        this.copy(qb);
    }

    if (cosHalfTheta >= 1.0) {
        this._w = w;
        this._x = x;
        this._y = y;
        this._z = z;

        return this;
    }

    const sinHalfTheta = Math.sqrt(1.0 - cosHalfTheta * cosHalfTheta);
    const halfTheta = Math.atan2(sinHalfTheta, cosHalfTheta);
    const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
    const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;

    this._w = (w * ratioA + this._w * ratioB);
    this._x = (x * ratioA + this._x * ratioB);
    this._y = (y * ratioA + this._y * ratioB);
    this._z = (z * ratioA + this._z * ratioB);

    this.onChangeCallback();

    return this;
};

// private members
var space = false;
const EPS = 0.000001;

// Orbit
const rotateStart = new THREE.Vector2();
const rotateEnd = new THREE.Vector2();
const rotateDelta = new THREE.Vector2();
const spherical = new THREE.Spherical(1.0, 0.01, Math.PI * 0.5);
const snapShotSpherical = new THREE.Spherical(1.0, 0.01, Math.PI * 0.5);
const sphericalDelta = new THREE.Spherical(1.0, 0, 0);
const sphericalTo = new THREE.Spherical();
const orbit = {
    spherical,
    sphericalDelta,
    sphericalTo,
    scale: 1,
};

// Pan
const panStart = new THREE.Vector2();
const panEnd = new THREE.Vector2();
const panDelta = new THREE.Vector2();
const panOffset = new THREE.Vector3();

const offset = new THREE.Vector3();

// Dolly
const dollyStart = new THREE.Vector2();
const dollyEnd = new THREE.Vector2();
const dollyDelta = new THREE.Vector2();

// Globe move
const quatGlobe = new THREE.Quaternion();
const cameraTargetOnGlobe = new THREE.Object3D();
const movingCameraTargetOnGlobe = new THREE.Vector3();
var animatedScale = 0.0;

const ctrl = {
    progress: 0,
    quatGlobe,
    qDelta: new THREE.Quaternion(),
    dampingFactor: 0.25,
};

ctrl.qDelta.presiceSlerp = presiceSlerp;
quatGlobe.presiceSlerp = presiceSlerp;

// Animation

let enableAnimation = true;

// Animation player
var player = null;
// Save 2 last rotation globe for damping
var lastRotation = [];
// Save the last time of mouse move for damping
var lastTimeMouseMove = 0;

// Expression used to damp camera's moves
var dampingMoveAnimatedExpression = (function getDampMoveAniExprFn() {
    const damp = new THREE.Quaternion(0, 0, 0, 1);
    return function dampingMoveAnimatedExpression(root) {
        root.qDelta.presiceSlerp(damp, root.dampingFactor * 0.2);
        root.quatGlobe.multiply(root.qDelta);
    };
}());

// Expression used to animate camera's moves and zoom
var zoomCenterAnimatedExpression = function zoomCenterAnimatedExpression(root, progress) {
    root.quatGlobe.set(0, 0, 0, 1);
    root.progress = 1 - Math.pow((1 - (Math.sin((progress - 0.5) * Math.PI) * 0.5 + 0.5)), 2);
    root.quatGlobe.presiceSlerp(root.qDelta, root.progress);
};

// Expression used to damp camera's moves
var animationOrbitExpression = function animationOrbitExpression(root, progress) {
    root.scale = 1.0 - (1.0 - root.sphericalTo.radius / root.spherical.radius) * progress;
    root.sphericalDelta.theta = root.sphericalTo.theta;
    root.sphericalDelta.phi = root.sphericalTo.phi;
};

// Animations
const animationDampingMove = new AnimatedExpression({ duration: 120, root: ctrl, expression: dampingMoveAnimatedExpression, name: 'damping-move' });
const animationZoomCenter = new AnimatedExpression({ duration: 45, root: ctrl, expression: zoomCenterAnimatedExpression, name: 'Zoom Center' });
const animationOrbit = new AnimatedExpression({ duration: 30, root: orbit, expression: animationOrbitExpression, name: 'set Orbit' });
const dampingOrbitalMvt = new Animation({ duration: 60, name: 'damping-orbit' });

// Replace matrix float by matrix double
cameraTargetOnGlobe.matrixWorldInverse = new THREE.Matrix4();

// Pan Move
const panVector = new THREE.Vector3();

// Save last transformation
const lastPosition = new THREE.Vector3();
const lastQuaternion = new THREE.Quaternion();

// State control
var state = CONTROL_STATE.NONE;

// Initial transformation
var initialTarget;
var initialPosition;
var initialZoom;

// picking
const ptScreenClick = new THREE.Vector2();
const sizeRendering = new THREE.Vector2();

// Tangent sphere to ellipsoid
const tSphere = new Sphere();
tSphere.picking = { position: new THREE.Vector3(), normal: new THREE.Vector3() };

// Special key
var keyCtrl = false;
var keyShift = false;
var keyS = false;

// Set to true to enable target helper
const enableTargetHelper = false;
let pickingHelper;

if (enableTargetHelper) {
    pickingHelper = new THREE.AxisHelper(500000);
}

// Handle function
var _handlerMouseMove;
var _handlerMouseUp;

// Event
let enableEventPositionChanged = true;

/**
 * Globe control pan event. Fires after camera pan
 * @event GlobeControls#pan-changed
 * @property target {GlobeControls} dispatched on controls
 * @property type {string} orientation-changed
 */
/**
 * Globe control orientation event. Fires when camera's orientation change
 * @event GlobeControls#orientation-changed
 * @property new {object}
 * @property new.tilt {number} the new value of the tilt of the camera
 * @property new.heading {number} the new value of the heading of the camera
 * @property previous {object}
 * @property previous.tilt {number} the previous value of the tilt of the camera
 * @property previous.heading {number} the previous value of the heading of the camera
 * @property target {GlobeControls} dispatched on controls
 * @property type {string} orientation-changed
 */
 /**
 * Globe control range event. Fires when camera's range to target change
 * @event GlobeControls#range-changed
 * @property new {object}
 * @property new.range {number} the new value of the range
 * @property previous {object}
 * @property previous.range {number} the previous value of the range
 * @property target {GlobeControls} dispatched on controls
 * @property type {string} range-changed
 */
 /**
 * Globe control camera's target event. Fires when camera's target change
 * @event GlobeControls#camera-target-changed
 * @property new {object}
 * @property new.cameraTarget {Coordinates} the new camera's target coordinates
 * @property new.cameraTarget.crs {string} the crs of the camera's target coordinates
 * @property new.cameraTarget.values {array}
 * @property new.cameraTarget.values.0 {number} the new X coordinates
 * @property new.cameraTarget.values.1 {number} the new Y coordinates
 * @property new.cameraTarget.values.2 {number} the new Z coordinates
 * @property new.heading {number} the new value of the heading of the camera
 * @property previous {object}
 * @property previous.cameraTarget {Coordinates} the previous camera's target coordinates
 * @property previous.cameraTarget.crs {string} the crs of the camera's target coordinates
 * @property previous.cameraTarget.values {array}
 * @property previous.cameraTarget.values.0 {number} the previous X coordinates
 * @property previous.cameraTarget.values.1 {number} the previous Y coordinates
 * @property previous.cameraTarget.values.2 {number} the previous Z coordinates
 * @property target {GlobeControls} dispatched on controls
 * @property type {string} camera-target-changed
 */

/**
 * globe controls events
 * @property PAN_CHANGED {string} Fires after camera pan
 * @property ORIENTATION_CHANGED {string} Fires when camera's orientation change
 * @property RANGE_CHANGED {string} Fires when camera's range to target change
 * @property CAMERA_TARGET_CHANGED {string} Fires when camera's target change
 */

export const CONTROL_EVENTS = {
    PAN_CHANGED: 'pan-changed',
    ORIENTATION_CHANGED: 'orientation-changed',
    RANGE_CHANGED: 'range-changed',
    CAMERA_TARGET_CHANGED: 'camera-target-changed',
};


// SnapCamera saves transformation's camera
// It's use to globe move
function SnapCamera(camera) {
    camera.updateMatrixWorld();

    this.matrixWorld = new THREE.Matrix4();
    this.projectionMatrix = new THREE.Matrix4();
    this.invProjectionMatrix = new THREE.Matrix4();
    this.position = new THREE.Vector3();

    this.init = function init(camera) {
        this.matrixWorld.copy(camera.matrixWorld);
        this.projectionMatrix.copy(camera.projectionMatrix);
        this.position.copy(camera.position);
        this.invProjectionMatrix.getInverse(this.projectionMatrix);
    };

    this.init(camera);

    this.shot = function shot(objectToSnap) {
        objectToSnap.updateMatrixWorld();
        this.matrixWorld.copy(objectToSnap.matrixWorld);
        this.position.copy(objectToSnap.position);
    };

    const matrix = new THREE.Matrix4();

    this.updateRay = function updateRay(ray, mouse) {
        ray.origin.copy(this.position);
        ray.direction.set(mouse.x, mouse.y, 0.5);
        matrix.multiplyMatrices(this.matrixWorld, this.invProjectionMatrix);
        ray.direction.applyMatrix4(matrix);
        ray.direction.sub(ray.origin).normalize();
    };
}

var snapShotCamera = null;

function defer() {
    const deferedPromise = {};
    deferedPromise.promise = new Promise((resolve, reject) => {
        deferedPromise.resolve = resolve;
        deferedPromise.reject = reject;
    });
    return deferedPromise;
}

/* globals document,window */

/**
 * @class
 * @param {GlobeView} view
 * @param {*} target
 * @param {number} radius
 * @param {options} options
 */
function GlobeControls(view, target, radius, options = {}) {
    player = new AnimationPlayer();
    this._view = view;
    this.camera = view.camera.camera3D;
    this.domElement = view.mainLoop.gfxEngine.renderer.domElement;

    snapShotCamera = new SnapCamera(this.camera);

    this.waitSceneLoaded = function waitSceneLoaded() {
        const deferedPromise = defer();
        this._view.mainLoop.addEventListener('command-queue-empty', () => {
            deferedPromise.resolve();
        });
        return deferedPromise.promise;
    };

    // Set to false to disable this control
    this.enabled = true;

    // This option actually enables dollying in and out; left as "zoom" for
    // backwards compatibility
    this.enableZoom = true;
    this.zoomSpeed = options.zoomSpeed || 2.0;

    // Limits to how far you can dolly in and out ( PerspectiveCamera only )
    this.minDistance = options.minDistance || 30;
    this.maxDistance = options.maxDistance || radius * 8.0;

    // Limits to how far you can zoom in and out ( OrthographicCamera only )
    this.minZoom = 0;
    this.maxZoom = Infinity;

    // Set to true to disable this control
    this.enableRotate = true;
    this.rotateSpeed = options.rotateSpeed || 0.25;

    // Set to true to disable this control
    this.enablePan = true;
    this.keyPanSpeed = 7.0; // pixels moved per arrow key push

    // Set to true to automatically rotate around the target
    this.autoRotate = false;
    this.autoRotateSpeed = 2.0; // 30 seconds per round when fps is 60

    // How far you can orbit vertically, upper and lower limits.
    // Range is 0 to Math.PI radians.
    // TODO Warning minPolarAngle = 0.01 -> it isn't possible to be perpendicular on Globe
    this.minPolarAngle = 0.01; // radians
    this.maxPolarAngle = Math.PI * 0.5; // radians

    // How far you can orbit horizontally, upper and lower limits.
    // If set, must be a sub-interval of the interval [ - Math.PI, Math.PI ].
    this.minAzimuthAngle = -Infinity; // radians
    this.maxAzimuthAngle = Infinity; // radians

    // Set collision options
    this.handleCollision = typeof (options.handleCollision) !== 'undefined' ? options.handleCollision : true;
    this.minDistanceCollision = 100;

    // Set to true to disable use of the keys
    this.enableKeys = true;

    // Enable Damping
    this.enableDamping = true;

    if (enableTargetHelper) {
        this.pickingHelper = new THREE.AxisHelper(500000);
    }

    // Mouse buttons
    this.mouseButtons = {
        PANORAMIC: THREE.MOUSE.LEFT,
        ZOOM: THREE.MOUSE.MIDDLE,
        PAN: THREE.MOUSE.RIGHT,
    };

    // Radius tangent sphere
    tSphere.setRadius(radius);
    spherical.radius = tSphere.radius;

    sizeRendering.copy(view.mainLoop.gfxEngine.getWindowSize());
    sizeRendering.FOV = this.camera.fov;
    // Note A
    // TODO: test before remove test code
    // so camera.up is the orbit axis
    // var quat = new THREE.Quaternion().setFromUnitVectors(camera.up, new THREE.Vector3(0, 1, 0));
    // var quatInverse = quat.clone().inverse();

    this.startEvent = {
        type: 'start',
    };
    this.endEvent = {
        type: 'end',
    };

    this.updateCamera = function updateCamera() {
        snapShotCamera.init(this.camera);
        sizeRendering.width = this.domElement.clientWidth;
        sizeRendering.height = this.domElement.clientHeight;
        sizeRendering.FOV = this.camera.fov;
    };

    window.addEventListener('resize', this.updateCamera.bind(this), false);

    this.getAutoRotationAngle = function getAutoRotationAngle() {
        return 2 * Math.PI / 60 / 60 * this.autoRotateSpeed;
    };

    this.getDollyScale = function getDollyScale() {
        return Math.pow(0.95, this.zoomSpeed);
    };

    this.rotateLeft = function rotateLeft(angle) {
        if (angle === undefined) {
            angle = this.getAutoRotationAngle();
        }
        sphericalDelta.theta -= angle;
    };

    this.rotateUp = function rotateUp(angle) {
        if (angle === undefined) {
            angle = this.getAutoRotationAngle();
        }

        sphericalDelta.phi -= angle;
    };

    // pass in distance in world space to move left
    this.panLeft = function panLeft(distance) {
        var te = this.camera.matrix.elements;

        // get X column of matrix
        panOffset.set(te[0], te[1], te[2]);
        panOffset.multiplyScalar(-distance);

        panVector.add(panOffset);
    };

    // pass in distance in world space to move up
    this.panUp = function panUp(distance) {
        var te = this.camera.matrix.elements;

        // get Y column of matrix
        panOffset.set(te[4], te[5], te[6]);
        panOffset.multiplyScalar(distance);

        panVector.add(panOffset);
    };

    // pass in x,y of change desired in pixel space,
    // right and down are positive
    this.mouseToPan = function mouseToPan(deltaX, deltaY) {
        var element = this.domElement === document ? this.domElement.body : this.domElement;

        if (this.camera instanceof THREE.PerspectiveCamera) {
            // perspective
            var position = this.camera.position;

            // var offset = position.clone().sub(this.target);
            var offset = position.clone().sub(this.getCameraTargetPosition());

            var targetDistance = offset.length();

            // half of the fov is center to top of screen
            targetDistance *= Math.tan((this.camera.fov / 2) * Math.PI / 180.0);

            // we actually don't use screenWidth, since perspective camera is fixed to screen height
            this.panLeft(2 * deltaX * targetDistance * this.camera.aspect / element.clientWidth);
            this.panUp(2 * deltaY * targetDistance / element.clientHeight);
        } else if (this.camera instanceof THREE.OrthographicCamera) {
            // orthographic
            this.panLeft(deltaX * (this.camera.right - this.camera.left) / element.clientWidth);
            this.panUp(deltaY * (this.camera.top - this.camera.bottom) / element.clientHeight);
        } else {

            // camera neither orthographic or perspective
            // console.warn('WARNING: GlobeControls.js encountered an unknown camera type - this.mouseToPan disabled.');

        }
    };

    this.dollyIn = function dollyIn(dollyScale) {
        if (dollyScale === undefined) {
            dollyScale = this.getDollyScale();
        }

        if (this.camera instanceof THREE.PerspectiveCamera) {
            orbit.scale /= dollyScale;
        } else if (this.camera instanceof THREE.OrthographicCamera) {
            this.camera.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.camera.zoom * dollyScale));
            this.camera.updateProjectionMatrix();
            this._view.notifyChange(true, this.camera);
        } else {

            // console.warn('WARNING: GlobeControls.js encountered an unknown camera type - dolly/zoom disabled.');

        }
    };

    this.dollyOut = function dollyOut(dollyScale) {
        if (dollyScale === undefined) {
            dollyScale = this.getDollyScale();
        }

        if (this.camera instanceof THREE.PerspectiveCamera) {
            orbit.scale *= dollyScale;
        } else if (this.camera instanceof THREE.OrthographicCamera) {
            this.camera.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.camera.zoom / dollyScale));
            this.camera.updateProjectionMatrix();
            this._view.notifyChange(true, this.camera);
        } else {

            // console.warn('WARNING: GlobeControls.js encountered an unknown camera type - dolly/zoom disabled.');

        }
    };

    const quaterPano = new THREE.Quaternion();
    const quaterAxis = new THREE.Quaternion();
    const axisX = new THREE.Vector3(1, 0, 0);

    var update = function update() {
        // We test if camera collide to geometry layer or too close to ground and ajust it's altitude in case
        if (this.handleCollision) { // We check distance to the ground/surface geometry. (Could be another geometry layer)
            this._view.camera.adjustAltitudeToAvoidCollisionWithLayer(this._view, view.getLayers(layer => layer.type === 'geometry')[0], this.minDistanceCollision);
        }
        // MOVE_GLOBE
        // Rotate globe with mouse
        if (state === CONTROL_STATE.MOVE_GLOBE) {
            movingCameraTargetOnGlobe.copy(this.getCameraTargetPosition()).applyQuaternion(quatGlobe);
            this.camera.position.copy(snapShotCamera.position).applyQuaternion(quatGlobe);
            // combine zoom with move globe
            if (ctrl.progress > 0) {
                this.camera.position.lerp(movingCameraTargetOnGlobe, ctrl.progress * animatedScale);
            }
            this.camera.up.copy(movingCameraTargetOnGlobe.clone().normalize());
        // PAN
        // Move camera in projection plan
        } else if (state === CONTROL_STATE.PAN) {
            this.camera.position.add(panVector);
            movingCameraTargetOnGlobe.add(panVector);
            this.camera.up.copy(movingCameraTargetOnGlobe.clone().normalize());
        // PANORAMIC
        // Move target camera
        } else if (state === CONTROL_STATE.PANORAMIC) {
            // TODO: this part must be reworked
            this.camera.worldToLocal(movingCameraTargetOnGlobe);
            var normal = this.camera.position.clone().normalize().applyQuaternion(this.camera.quaternion.clone().inverse());
            quaterPano.setFromAxisAngle(normal, sphericalDelta.theta).multiply(quaterAxis.setFromAxisAngle(axisX, sphericalDelta.phi));
            movingCameraTargetOnGlobe.applyQuaternion(quaterPano);
            this.camera.localToWorld(movingCameraTargetOnGlobe);
            this.camera.up.copy(movingCameraTargetOnGlobe.clone().normalize());
        } else {
            // ZOOM/ORBIT
            // Move Camera around the target camera

            // TODO: test before remove test code see (Note A)
            // offset.applyQuaternion( quat );

            // get camera position in local space of target
            offset.copy(this.camera.position).applyMatrix4(cameraTargetOnGlobe.matrixWorldInverse);

            // angle from z-axis around y-axis
            if (sphericalDelta.theta || sphericalDelta.phi) {
                spherical.setFromVector3(offset);
            }

            if (this.autoRotate && state === CONTROL_STATE.NONE) {
                this.rotateLeft(this.getAutoRotationAngle());
            }

            spherical.theta += sphericalDelta.theta;
            spherical.phi += sphericalDelta.phi;

            // restrict spherical.theta to be between desired limits
            spherical.theta = Math.max(this.minAzimuthAngle, Math.min(this.maxAzimuthAngle, spherical.theta));

            // restrict spherical.phi to be between desired limits
            spherical.phi = Math.max(this.minPolarAngle, Math.min(this.maxPolarAngle, spherical.phi));

            spherical.radius = offset.length() * orbit.scale;

            // restrict spherical.phi to be betwee EPS and PI-EPS
            spherical.makeSafe();

            // restrict radius to be between desired limits
            spherical.radius = Math.max(this.minDistance, Math.min(this.maxDistance, spherical.radius));

            offset.setFromSpherical(spherical);

            // rotate point back to "camera-up-vector-is-up" space
            // offset.applyQuaternion( quatInverse );
            this.camera.position.copy(cameraTargetOnGlobe.localToWorld(offset));
        }

        this.camera.lookAt(movingCameraTargetOnGlobe);

        if (!this.enableDamping) {
            sphericalDelta.theta = 0;
            sphericalDelta.phi = 0;
        } else {
            sphericalDelta.theta *= (1 - ctrl.dampingFactor);
            sphericalDelta.phi *= (1 - ctrl.dampingFactor);
        }

        orbit.scale = 1;
        panVector.set(0, 0, 0);

        // update condition is:
        // min(camera displacement, camera rotation in radians)^2 > EPS
        // using small-angle approximation cos(x/2) = 1 - x^2 / 8

        if (lastPosition.distanceToSquared(this.camera.position) > EPS || 8 * (1 - lastQuaternion.dot(this.camera.quaternion)) > EPS) {
            this._view.notifyChange(true, this.camera);

            lastPosition.copy(this.camera.position);
            lastQuaternion.copy(this.camera.quaternion);
        }
        // Launch animationdamping if mouse stops these movements
        if (this.enableDamping && state === CONTROL_STATE.ORBIT && player.isStopped() && (sphericalDelta.theta > EPS || sphericalDelta.phi > EPS)) {
            player.playLater(dampingOrbitalMvt, 2);
        }
    }.bind(this);

    this.getSpace = function getSpace() {
        return space;
    };

    this.getSphericalDelta = function getSphericalDelta() {
        return sphericalDelta;
    };

    // Position object on globe
    var positionObject = (function getPositionObjectFn()
    {
        const quaterionX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
        return function positionObject(newPosition, object)
        {
            object.position.copy(newPosition);
            object.lookAt(newPosition.clone().multiplyScalar(1.1));
            object.quaternion.multiply(quaterionX);
            object.updateMatrixWorld();
        };
    }());

    // set new camera target on globe
    const setCameraTargetObjectPosition = function setCameraTargetObjectPosition(newPosition) {
        // Compute the new target position
        positionObject(newPosition, cameraTargetOnGlobe);

        cameraTargetOnGlobe.matrixWorldInverse.getInverse(cameraTargetOnGlobe.matrixWorld);
    };

    const cT = new THREE.Vector3();
    const delta = 0.001;

    const updateCameraTargetOnGlobe = function updateCameraTargetOnGlobe() {
        const previousCameraTargetOnGlobe = cameraTargetOnGlobe.position.clone();

        // Get distance camera DME
        const pickingPosition = view.getPickingPositionFromDepth();

        if (!pickingPosition) {
            return;
        }

        const distanceTarget = pickingPosition.distanceTo(this.camera.position);

        // Position movingCameraTargetOnGlobe on DME
        cT.subVectors(movingCameraTargetOnGlobe, this.camera.position);
        cT.setLength(distanceTarget);
        movingCameraTargetOnGlobe.addVectors(this.camera.position, cT);

        setCameraTargetObjectPosition(movingCameraTargetOnGlobe);

        // update spherical from target
        offset.copy(this.camera.position);
        offset.applyMatrix4(cameraTargetOnGlobe.matrixWorldInverse);
        spherical.setFromVector3(offset);

        if (enableEventPositionChanged) {
            if (state === CONTROL_STATE.ORBIT && (Math.abs(snapShotSpherical.phi - spherical.phi) > delta || Math.abs(snapShotSpherical.theta - spherical.theta) > delta)) {
                this.dispatchEvent({
                    type: CONTROL_EVENTS.ORIENTATION_CHANGED,
                    previous: {
                        tilt: snapShotSpherical.phi * 180 / Math.PI,
                        heading: snapShotSpherical.theta * 180 / Math.PI,
                    },
                    new: {
                        tilt: spherical.phi * 180 / Math.PI,
                        heading: spherical.theta * 180 / Math.PI,
                    },
                });
            } else if (state === CONTROL_STATE.PAN) {
                this.dispatchEvent({
                    type: CONTROL_EVENTS.PAN_CHANGED,
                });
            }

            const previousRange = snapShotSpherical.radius;
            const newRange = this.getRange();
            if (Math.abs(newRange - previousRange) / previousRange > 0.001) {
                this.dispatchEvent({
                    type: CONTROL_EVENTS.RANGE_CHANGED,
                    previous: { range: previousRange },
                    new: { range: newRange },
                });
            }

            if (cameraTargetOnGlobe.position.distanceTo(previousCameraTargetOnGlobe) / spherical.radius > delta) {
                this.dispatchEvent({
                    type: CONTROL_EVENTS.CAMERA_TARGET_CHANGED,
                    previous: { cameraTarget: new Coordinates(this._view.referenceCrs, previousCameraTargetOnGlobe) },
                    new: { cameraTarget: new Coordinates(this._view.referenceCrs, cameraTargetOnGlobe.position) },
                });
            }
            snapShotSpherical.copy(spherical);
        }

        state = CONTROL_STATE.NONE;
        lastRotation = [];
        if (enableTargetHelper) {
            this._view.notifyChange(true, cameraTargetOnGlobe);
        }
    };

    // Update helper
    var updateHelper = enableTargetHelper ? function updateHelper(position, helper) {
        positionObject(position, helper);
        this._view.notifyChange(true, cameraTargetOnGlobe);
    } : function empty() {};

    this.getPickingPositionOnSphere = function getPickingPositionOnSphere() {
        return tSphere.picking.position;
    };

    // Update radius's sphere : the sphere must cross the point
    // Return intersection with mouse and sphere
    var updateSpherePicking = (function getUpdateSpherePicking() {
        var mouse = new THREE.Vector2();
        var ray = new THREE.Ray();

        return function updateSpherePicking(point, screenCoord) {
            tSphere.setRadius(point.length());

            mouse.x = (screenCoord.x / sizeRendering.width) * 2 - 1;
            mouse.y = -(screenCoord.y / sizeRendering.height) * 2 + 1;

            snapShotCamera.updateRay(ray, mouse);
            // pick position on tSphere
            const its = tSphere.intersectWithRay(ray);
            if (its != undefined) {
                tSphere.picking.position.copy(its);
                tSphere.picking.normal = tSphere.picking.position.clone().normalize();

                lastRotation.push(tSphere.picking.normal);
                updateHelper.bind(this)(tSphere.picking.position, pickingHelper);
            }
        };
    }());

    var onMouseMove = (function getOnMouseMoveFn() {
        var ray = new THREE.Ray();
        var mouse = new THREE.Vector2();

        return function onMouseMove(event)
        {
            if (player.isPlaying()) {
                player.stop();
            }
            if (this.enabled === false) return;

            event.preventDefault();

            if (state === CONTROL_STATE.ORBIT || state === CONTROL_STATE.PANORAMIC) {
                if (this.enableRotate === false) return;

                rotateEnd.set(event.clientX - event.target.offsetLeft, event.clientY - event.target.offsetTop);
                rotateDelta.subVectors(rotateEnd, rotateStart);

                // rotating across whole screen goes 360 degrees around
                if (!space) {
                    this.rotateLeft(2 * Math.PI * rotateDelta.x / sizeRendering.width * this.rotateSpeed);

                    // rotating up and down along whole screen attempts to go 360, but limited to 180
                    this.rotateUp(2 * Math.PI * rotateDelta.y / sizeRendering.height * this.rotateSpeed);
                } else {
                    this.rotateLeft(rotateDelta.x);

                    // rotating up and down along whole screen attempts to go 360, but limited to 180
                    this.rotateUp(rotateDelta.y);
                }

                rotateStart.copy(rotateEnd);
            } else if (state === CONTROL_STATE.DOLLY) {
                if (this.enableZoom === false) return;

                dollyEnd.set(event.clientX - event.target.offsetLeft, event.clientY - event.target.offsetTop);
                dollyDelta.subVectors(dollyEnd, dollyStart);

                if (dollyDelta.y > 0) {
                    this.dollyIn();
                } else if (dollyDelta.y < 0) {
                    this.dollyOut();
                }

                dollyStart.copy(dollyEnd);
            } else if (state === CONTROL_STATE.PAN) {
                if (this.enablePan === false) return;

                panEnd.set(event.clientX - event.target.offsetLeft, event.clientY - event.target.offsetTop);
                panDelta.subVectors(panEnd, panStart);

                this.mouseToPan(panDelta.x, panDelta.y);

                panStart.copy(panEnd);
            } else if (state === CONTROL_STATE.MOVE_GLOBE) {
                mouse.x = ((event.clientX - event.target.offsetLeft) / sizeRendering.width) * 2 - 1;
                mouse.y = -((event.clientY - event.target.offsetTop) / sizeRendering.height) * 2 + 1;

                snapShotCamera.updateRay(ray, mouse);

                var intersection = tSphere.intersectWithRay(ray);

                // If there's intersection then move globe else we stop the move
                if (intersection) {
                    var normalizedIntersection = intersection.normalize();
                    quatGlobe.setFromUnitVectors(normalizedIntersection, tSphere.picking.normal);
                    // backups last move globe for damping
                    lastRotation.push(normalizedIntersection.clone());
                    lastTimeMouseMove = Date.now();
                    // Remove unnecessary movements backups
                    if (lastRotation.length > 2) {
                        lastRotation.splice(0, 1);
                    }
                } else {
                    onMouseUp.bind(this)();
                }
            }

            if (state !== CONTROL_STATE.NONE) {
                update();
            }
        };
    }());

    var onMouseDown = function onMouseDown(event) {
        player.stop().then(() => {
            if (this.enabled === false) return;
            event.preventDefault();

            if (event.button === this.mouseButtons.PANORAMIC) {
                if (this.enableRotate === false) return;

                if (keyCtrl) {
                    state = CONTROL_STATE.ORBIT;
                } else if (keyShift) {
                    state = CONTROL_STATE.PANORAMIC;
                } else if (keyS) {
                    // If the key 'S' is down, the engine selects node under mouse
                    this._view.selectNodeAt(new THREE.Vector2(event.clientX - event.target.offsetLeft, event.clientY - event.target.offsetTop));
                } else {
                    snapShotCamera.shot(this.camera);
                    ptScreenClick.x = event.clientX - event.target.offsetLeft;
                    ptScreenClick.y = event.clientY - event.target.offsetTop;

                    const point = view.getPickingPositionFromDepth(ptScreenClick);
                    lastRotation = [];
                    // update tangent sphere which passes through the point
                    if (point) {
                        ctrl.range = this.getRange();
                        updateSpherePicking.bind(this)(point, ptScreenClick);
                        state = CONTROL_STATE.MOVE_GLOBE;
                    }
                }

                rotateStart.set(event.clientX - event.target.offsetLeft, event.clientY - event.target.offsetTop);
            } else if (event.button === this.mouseButtons.ZOOM) {
                if (this.enableZoom === false) return;

                state = CONTROL_STATE.DOLLY;

                dollyStart.set(event.clientX - event.target.offsetLeft, event.clientY - event.target.offsetTop);
            } else if (event.button === this.mouseButtons.PAN) {
                if (this.enablePan === false) return;

                state = CONTROL_STATE.PAN;

                panStart.set(event.clientX - event.target.offsetLeft, event.clientY - event.target.offsetTop);
            }

            if (state !== CONTROL_STATE.NONE) {
                this.domElement.addEventListener('mousemove', _handlerMouseMove, false);
                this.domElement.addEventListener('mouseup', _handlerMouseUp, false);
                this.domElement.addEventListener('mouseleave', _handlerMouseUp, false);
                this.dispatchEvent(this.startEvent);
            }
        });
    };

    var ondblclick = function ondblclick(event) {
        if (this.enabled === false) return;

        // Double click throws move camera's target with animation
        if (!keyCtrl && !keyShift) {
            ptScreenClick.x = event.clientX - event.target.offsetLeft;
            ptScreenClick.y = event.clientY - event.target.offsetTop;

            const point = view.getPickingPositionFromDepth(ptScreenClick);

            if (point) {
                animatedScale = 0.6;
                this.setCameraTargetPosition(point, this.isAnimationEnabled());
            }
        }
    };

    var onMouseUp = function onMouseUp(/* event */) {
        if (this.enabled === false) return;

        this.domElement.removeEventListener('mousemove', _handlerMouseMove, false);
        this.domElement.removeEventListener('mouseup', _handlerMouseUp, false);
        this.domElement.removeEventListener('mouseleave', _handlerMouseUp, false);
        this.dispatchEvent(this.endEvent);

        player.stop();

        // Launch damping movement for :
        //      * CONTROL_STATE.ORBIT
        //      * CONTROL_STATE.MOVE_GLOBE
        if (this.enableDamping) {
            if (state === CONTROL_STATE.ORBIT && (sphericalDelta.theta > EPS || sphericalDelta.phi > EPS)) {
                player.play(dampingOrbitalMvt).then(() => this.resetControls());
            } else if (state === CONTROL_STATE.MOVE_GLOBE && lastRotation.length === 2 && (Date.now() - lastTimeMouseMove < 50) && !(lastRotation[1].equals(lastRotation[0]))) {
                // animation since mouse up event occurs less than 50ms after the last mouse move
                ctrl.qDelta.setFromUnitVectors(lastRotation[1], lastRotation[0]);
                player.play(animationDampingMove).then(() => this.resetControls());
            } else {
                updateCameraTargetOnGlobe.bind(this)();
            }
        } else {
            updateCameraTargetOnGlobe.bind(this)();
        }
    };

    var onMouseWheel = function onMouseWheel(event) {
        player.stop().then(() => {
            if (this.enabled === false || this.enableZoom === false) return;

            event.preventDefault();
            event.stopPropagation();

            var delta = 0;

            // WebKit / Opera / Explorer 9
            if (event.wheelDelta !== undefined) {
                delta = event.wheelDelta;
            // Firefox
            } else if (event.detail !== undefined) {
                delta = -event.detail;
            }

            if (delta > 0) {
                this.dollyOut();
            } else if (delta < 0) {
                this.dollyIn();
            }

            const previousRange = this.getRange();
            update();
            const newRange = this.getRange();
            if (Math.abs(newRange - previousRange) / previousRange > 0.001 && enableEventPositionChanged) {
                this.dispatchEvent({
                    type: CONTROL_EVENTS.RANGE_CHANGED,
                    previous: { range: previousRange },
                    new: { range: newRange },
                });
            }
            snapShotSpherical.copy(spherical);

            this.dispatchEvent(this.startEvent);
            this.dispatchEvent(this.endEvent);
        });
    };

    var onKeyUp = function onKeyUp() {
        if (this.enabled === false || this.enableKeys === false || this.enablePan === false) return;


        if (state === CONTROL_STATE.PAN)
        {
            updateCameraTargetOnGlobe.bind(this)();
        }

        keyCtrl = false;
        keyShift = false;
        keyS = false;
    };

    var onKeyDown = function onKeyDown(event) {
        player.stop().then(() => {
            if (this.enabled === false || this.enableKeys === false || this.enablePan === false) return;
            keyCtrl = false;
            keyShift = false;

            switch (event.keyCode) {
                case CONTROL_KEYS.UP:
                    this.mouseToPan(0, this.keyPanSpeed);
                    state = CONTROL_STATE.PAN;
                    update();
                    break;
                case CONTROL_KEYS.BOTTOM:
                    this.mouseToPan(0, -this.keyPanSpeed);
                    state = CONTROL_STATE.PAN;
                    update();
                    break;
                case CONTROL_KEYS.LEFT:
                    this.mouseToPan(this.keyPanSpeed, 0);
                    state = CONTROL_STATE.PAN;
                    update();
                    break;
                case CONTROL_KEYS.RIGHT:
                    this.mouseToPan(-this.keyPanSpeed, 0);
                    state = CONTROL_STATE.PAN;
                    update();
                    break;
                // TODO Why space key, looking for movement
                case CONTROL_KEYS.SPACE:
                    space = !space;
                    // this.updateTarget();
                    update();
                    break;
                case CONTROL_KEYS.CTRL:
                    // computeVectorUp();
                    keyCtrl = true;
                    break;
                case CONTROL_KEYS.SHIFT:
                    // computeVectorUp();
                    keyShift = true;
                    break;
                case CONTROL_KEYS.S:
                    // WARNING loop !!!
                    keyS = true;
                    break;
                default:
            }
        });
    };

    var onTouchStart = function onTouchStart(event) {
        if (this.enabled === false) return;

        switch (event.touches.length) {

            case 1: // one-fingered touch: rotate

                if (this.enableRotate === false) return;

                state = CONTROL_STATE.TOUCH_ROTATE;

                rotateStart.set(event.touches[0].pageX, event.touches[0].pageY);
                break;

            case 2: // two-fingered touch: dolly

                if (this.enableZoom === false) return;

                state = CONTROL_STATE.TOUCH_DOLLY;

                var dx = event.touches[0].pageX - event.touches[1].pageX;
                var dy = event.touches[0].pageY - event.touches[1].pageY;
                var distance = Math.sqrt(dx * dx + dy * dy);
                dollyStart.set(0, distance);
                break;

            case 3: // three-fingered touch: this.mouseToPan

                if (this.enablePan === false) return;

                state = CONTROL_STATE.TOUCH_PAN;

                panStart.set(event.touches[0].pageX, event.touches[0].pageY);
                break;

            default:

                state = CONTROL_STATE.NONE;

        }

        if (state !== CONTROL_STATE.NONE) this.dispatchEvent(this.startEvent);
    };

    var onTouchMove = function onTouchMove(event) {
        if (this.enabled === false) return;

        event.preventDefault();
        event.stopPropagation();

        var element = this.domElement === document ? this.domElement.body : this.domElement;

        switch (event.touches.length) {

            case 1: // one-fingered touch: rotate

                if (this.enableRotate === false) return;
                if (state !== CONTROL_STATE.TOUCH_ROTATE) return;

                rotateEnd.set(event.touches[0].pageX, event.touches[0].pageY);
                rotateDelta.subVectors(rotateEnd, rotateStart);

                // rotating across whole screen goes 360 degrees around
                this.rotateLeft(2 * Math.PI * rotateDelta.x / element.clientWidth * this.rotateSpeed);
                // rotating up and down along whole screen attempts to go 360, but limited to 180
                this.rotateUp(2 * Math.PI * rotateDelta.y / element.clientHeight * this.rotateSpeed);

                rotateStart.copy(rotateEnd);

                update();
                break;

            case 2: // two-fingered touch: dolly

                if (this.enableZoom === false) return;
                if (state !== CONTROL_STATE.TOUCH_DOLLY) return;

                var dx = event.touches[0].pageX - event.touches[1].pageX;
                var dy = event.touches[0].pageY - event.touches[1].pageY;
                var distance = Math.sqrt(dx * dx + dy * dy);

                dollyEnd.set(0, distance);
                dollyDelta.subVectors(dollyEnd, dollyStart);

                if (dollyDelta.y > 0) {
                    this.dollyOut();
                } else if (dollyDelta.y < 0) {
                    this.dollyIn();
                }

                dollyStart.copy(dollyEnd);

                update();
                break;

            case 3: // three-fingered touch: this.mouseToPan

                if (this.enablePan === false) return;
                if (state !== CONTROL_STATE.TOUCH_PAN) return;

                panEnd.set(event.touches[0].pageX, event.touches[0].pageY);
                panDelta.subVectors(panEnd, panStart);

                this.mouseToPan(panDelta.x, panDelta.y);

                panStart.copy(panEnd);

                update();
                break;

            default:

                state = CONTROL_STATE.NONE;

        }
    };

    var onTouchEnd = function onTouchEnd(/* event */) {
        if (this.enabled === false) return;

        this.dispatchEvent(this.endEvent);
        state = CONTROL_STATE.NONE;
        keyCtrl = false;
        keyShift = false;
        keyS = false;
    };

    // Callback launched when player is stopped
    this.resetControls = function resetControls() {
        lastRotation.splice(0);
        ctrl.progress = 0;
        updateCameraTargetOnGlobe.bind(this)();
    };

    // update object camera position
    this.updateCameraTransformation = function updateCameraTransformation(controlState, updateCameraTarget = true)
    {
        const bkDamping = this.enableDamping;
        this.enableDamping = false;
        state = controlState || CONTROL_STATE.ORBIT;
        update();
        if (updateCameraTarget) {
            updateCameraTargetOnGlobe.bind(this)();
        }
        this.enableDamping = bkDamping;
    };

    this.dispose = function dispose() {
        // this.domElement.removeEventListener( 'contextmenu', onContextMenu, false );
        this.domElement.removeEventListener('mousedown', onMouseDown, false);
        this.domElement.removeEventListener('mousewheel', onMouseWheel, false);
        this.domElement.removeEventListener('DOMMouseScroll', onMouseWheel, false); // firefox

        this.domElement.removeEventListener('touchstart', onTouchStart, false);
        this.domElement.removeEventListener('touchend', onTouchEnd, false);
        this.domElement.removeEventListener('touchmove', onTouchMove, false);

        this.domElement.removeEventListener('mousemove', onMouseMove, false);
        this.domElement.removeEventListener('mouseup', onMouseUp, false);

        window.removeEventListener('keydown', onKeyDown, false);

        // this.dispatchEvent( { type: 'dispose' } ); // should this be added here?
    };

    // Instance all
    this.domElement.addEventListener('contextmenu', (event) => {
        event.preventDefault();
    }, false);
    this.domElement.addEventListener('mousedown', onMouseDown.bind(this), false);
    this.domElement.addEventListener('mousewheel', onMouseWheel.bind(this), false);
    this.domElement.addEventListener('dblclick', ondblclick.bind(this), false);
    this.domElement.addEventListener('DOMMouseScroll', onMouseWheel.bind(this), false); // firefox

    this.domElement.addEventListener('touchstart', onTouchStart.bind(this), false);
    this.domElement.addEventListener('touchend', onTouchEnd.bind(this), false);
    this.domElement.addEventListener('touchmove', onTouchMove.bind(this), false);

    // refresh control for each animation's frame
    player.addEventListener('animation-frame', update.bind(this));

    function isAnimationWithoutDamping(animation) {
        return animation && !(animation.name === 'damping-move' || animation.name === 'damping-orbit');
    }

    player.addEventListener('animation-started', (e) => {
        if (isAnimationWithoutDamping(e.animation)) {
            this.dispatchEvent({
                type: 'animation-started',
            });
        }
    });

    player.addEventListener('animation-ended', (e) => {
        if (isAnimationWithoutDamping(e.animation)) {
            this.dispatchEvent({
                type: 'animation-ended',
            });
        }
    });

    // TODO: Why windows
    window.addEventListener('keydown', onKeyDown.bind(this), false);
    window.addEventListener('keyup', onKeyUp.bind(this), false);

    // Initialisation Globe Target and movingGlobeTarget
    setCameraTargetObjectPosition(target);
    movingCameraTargetOnGlobe.copy(target);
    this.camera.up.copy(target.clone().normalize());
    this._view.scene.add(cameraTargetOnGlobe);
    spherical.radius = this.camera.position.length();

    update();

    if (enableTargetHelper) {
        cameraTargetOnGlobe.add(new THREE.AxisHelper(500000));
        this._view.scene.add(pickingHelper);
    }

    // Start position
    initialTarget = cameraTargetOnGlobe.clone();
    initialPosition = this.camera.position.clone();
    initialZoom = this.camera.zoom;
    snapShotSpherical.copy(spherical);

    _handlerMouseMove = onMouseMove.bind(this);
    _handlerMouseUp = onMouseUp.bind(this);

    this.waitSceneLoaded().then(() => {
        this.updateCameraTransformation();
        this._view.notifyChange(true, this.camera);
    });
}

GlobeControls.prototype = Object.create(THREE.EventDispatcher.prototype);
GlobeControls.prototype.constructor = GlobeControls;

function getRangeFromScale(scale, pitch) {
    // Screen pitch, in millimeters
    pitch = (pitch || 0.28) / 1000;
    const alpha = sizeRendering.FOV / 180 * Math.PI * 0.5;
    // Invert one unit projection (see getDollyScale)
    const range = pitch * sizeRendering.height / (scale * 2 * Math.tan(alpha));

    return range;
}

// # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #

/**
 * Changes the tilt of the current camera, in degrees.
 * <iframe width="100%" height="400" src="http://jsfiddle.net/iTownsIGN/p6t76zox/embedded/" allowfullscreen="allowfullscreen" frameborder="0"></iframe>
 * @param {number}  tilt
 * @param {boolean} isAnimated
 * @return {Promise<void>}
 */
GlobeControls.prototype.setTilt = function setTilt(tilt, isAnimated) {
    return this.setOrbitalPosition({ tilt }, isAnimated);
};

/**
 * Changes the heading of the current camera, in degrees.
 * <iframe width="100%" height="400" src="http://jsfiddle.net/iTownsIGN/rxe4xgxj/embedded/" allowfullscreen="allowfullscreen" frameborder="0"></iframe>
 * @param {number} heading
 * @param {boolean} isAnimated
 * @return {Promise<void>}
 */
GlobeControls.prototype.setHeading = function setHeading(heading, isAnimated) {
    return this.setOrbitalPosition({ heading }, isAnimated);
};

/**
 * Sets the "range": the distance in meters between the camera and the current central point on the screen.
 * <iframe width="100%" height="400" src="http://jsfiddle.net/iTownsIGN/Lt3jL5pd/embedded/" allowfullscreen="allowfullscreen" frameborder="0"></iframe>
 * @param {number} range
 * @param {boolean} isAnimated
 * @return {Promise<void>}
 */
GlobeControls.prototype.setRange = function setRange(range, isAnimated) {
    return this.setOrbitalPosition({ range }, isAnimated);
};

/**
 * Sets orientation angles of the current camera, in degrees.
 * <iframe width="100%" height="400" src="http://jsfiddle.net/iTownsIGN/9qr2mogh/embedded/" allowfullscreen="allowfullscreen" frameborder="0"></iframe>
 * @param {{tilt:number,heading:number,range:number}} position
 * @param {boolean}  isAnimated
 * @return {Promise<void>}
 */
GlobeControls.prototype.setOrbitalPosition = function setOrbitalPosition(position, isAnimated) {
    isAnimated = isAnimated === undefined ? this.isAnimationEnabled() : isAnimated;
    const deltaPhi = position.tilt === undefined ? 0 : position.tilt * Math.PI / 180 - this.getTiltRad();
    const deltaTheta = position.heading === undefined ? 0 : position.heading * Math.PI / 180 - this.getHeadingRad();
    const deltaRange = position.range === undefined ? 0 : position.range - this.getRange();
    return this.moveOrbitalPosition(deltaRange, deltaTheta, deltaPhi, isAnimated).then(() => {
        this._view.notifyChange(true);
        return this.waitSceneLoaded().then(() => {
            this.updateCameraTransformation();
        });
    });
};

const destSpherical = new THREE.Spherical();

GlobeControls.prototype.moveOrbitalPosition = function moveOrbitalPosition(deltaRange, deltaTheta, deltaPhi, isAnimated) {
    isAnimated = isAnimated === undefined ? this.isAnimationEnabled() : isAnimated;
    const range = deltaRange + this.getRange();
    if (isAnimated) {
        destSpherical.theta = deltaTheta + spherical.theta;
        destSpherical.phi = deltaPhi + spherical.phi;
        sphericalTo.radius = range;
        sphericalTo.theta = deltaTheta / (animationOrbit.duration - 1);
        sphericalTo.phi = deltaPhi / (animationOrbit.duration - 1);
        state = CONTROL_STATE.ORBIT;
        return player.play(animationOrbit).then(() => {
            // To correct errors at animation's end
            // TODO : find other solution to correct error
            if (player.isEnded()) {
                this.moveOrbitalPosition(0, destSpherical.theta - spherical.theta, destSpherical.phi - spherical.phi, false);
            }
            this.resetControls();
        });
    }
    else {
        sphericalDelta.theta = deltaTheta;
        sphericalDelta.phi = deltaPhi;
        orbit.scale = range / this.getRange();
        this.updateCameraTransformation(CONTROL_STATE.ORBIT, false);
        return Promise.resolve();
    }
};

/**
 * Returns the {@linkcode Coordinates} of the globe point targeted by the camera in EPSG:4978 projection. See {@linkcode Coordinates} for conversion
 * <iframe width="100%" height="400" src="http://jsfiddle.net/iTownsIGN/4tjgnv7z/embedded/" allowfullscreen="allowfullscreen" frameborder="0"></iframe>
 * @return {THREE.Vector3} position
 */
GlobeControls.prototype.getCameraTargetPosition = function getCameraTargetPosition() {
    return cameraTargetOnGlobe.position;
};

/**
 * Make the camera aim a point in the globe
 *
 * @param {THREE.Vector3} position - the position on the globe to aim, in EPSG:4978 projection
 * @param {boolean} isAnimated - if we should animate the move
 * @return {Promise<void>}
 */
GlobeControls.prototype.setCameraTargetPosition = function setCameraTargetPosition(position, isAnimated) {
    isAnimated = isAnimated === undefined ? this.isAnimationEnabled() : isAnimated;
    const center = this.getCameraTargetPosition();

    if (position.range) {
        // Compensation of the altitude from the approximation of the ellipsoid by a sphere
        // This approximation comes from the movements around the ellipsoid, are rotations with constant radius
        const currentTargetPosition = new Coordinates(this._view.referenceCrs, center).as('EPSG:4326');
        const targetOnEllipsoid = new C.EPSG_4326(currentTargetPosition.longitude(), currentTargetPosition.latitude(), 0)
            .as(this._view.referenceCrs).xyz();
        const compensation = position.length() - targetOnEllipsoid.length();
        // FIX ME error with compensation negative
        if (compensation > 0) {
            position.range += compensation;
        }
    }

    snapShotCamera.shot(this.camera);

    ptScreenClick.x = this.domElement.width / 2;
    ptScreenClick.y = this.domElement.height / 2;

    const vFrom = center.clone().normalize();
    const vTo = position.normalize();

    let promise;

    if (isAnimated) {
        ctrl.qDelta.setFromUnitVectors(vFrom, vTo);
        if (position.range) {
            animatedScale = 1.0 - position.range / this.getRange();
        }
        state = CONTROL_STATE.MOVE_GLOBE;
        promise = player.play(animationZoomCenter).then(() => {
            animatedScale = 0.0;
            this.resetControls();
        });
    }
    else {
        quatGlobe.setFromUnitVectors(vFrom, vTo);
        this.updateCameraTransformation(CONTROL_STATE.MOVE_GLOBE);
        if (animatedScale > 0.0 && animatedScale < 1.0) {
            this.setRange(this.getRange() * animatedScale);
        }
        promise = Promise.resolve();
    }

    return promise.then(() => {
        this._view.notifyChange(true);
        return this.waitSceneLoaded().then(() => {
            this.updateCameraTransformation();
        });
    });
};

/**
 * Returns the "range": the distance in meters between the camera and the current central point on the screen.
 * <iframe width="100%" height="400" src="http://jsfiddle.net/iTownsIGN/Lbt1vfek/embedded/" allowfullscreen="allowfullscreen" frameborder="0"></iframe>
 * @return {number} number
 */
GlobeControls.prototype.getRange = function getRange() {
    return this.getCameraTargetPosition().distanceTo(this.camera.position);
};

/**
 * Returns the tilt of the current camera in degrees.
 * <iframe width="100%" height="400" src="http://jsfiddle.net/iTownsIGN/kcx0of9j/embedded/" allowfullscreen="allowfullscreen" frameborder="0"></iframe>
 * @return {Angle} number - The angle of the rotation in degrees.
 */
GlobeControls.prototype.getTilt = function getTilt() {
    return spherical.phi * 180 / Math.PI;
};

/**
 * Returns the heading of the current camera in degrees.
 * <iframe width="100%" height="400" src="http://jsfiddle.net/iTownsIGN/pxv1Lw16/embedded/" allowfullscreen="allowfullscreen" frameborder="0"></iframe>
 * @return {Angle} number - The angle of the rotation in degrees.
 */
GlobeControls.prototype.getHeading = function getHeading() {
    return spherical.theta * 180 / Math.PI;
};

GlobeControls.prototype.getTiltRad = function getTiltRad() {
    return spherical.phi;
};

GlobeControls.prototype.getHeadingRad = function getHeadingRad() {
    return spherical.theta;
};

GlobeControls.prototype.getPolarAngle = function getPolarAngle() {
    return spherical.phi;
};

GlobeControls.prototype.getAzimuthalAngle = function getAzimuthalAngle() {
    return spherical.theta;
};

GlobeControls.prototype.moveTarget = function moveTarget() {
    return movingCameraTargetOnGlobe;
};

/**
 * Displaces the central point to a specific amount of pixels from its current position.
 * <iframe width="100%" height="400" src="http://jsfiddle.net/iTownsIGN/1z7q3c4z/embedded/" allowfullscreen="allowfullscreen" frameborder="0"></iframe>
 * The view flies to the desired coordinate, i.e.is not teleported instantly. Note : The results can be strange in some cases, if ever possible, when e.g.the camera looks horizontally or if the displaced center would not pick the ground once displaced.
 * @param      {vector}  pVector  The vector
 * @return {Promise<void>}
 */
GlobeControls.prototype.pan = function pan(pVector) {
    this.mouseToPan(pVector.x, pVector.y);
    this.updateCameraTransformation(CONTROL_STATE.PAN);
    this._view.notifyChange(true);
    return this.waitSceneLoaded().then(() => {
        this.updateCameraTransformation();
    });
};

/**
 * Returns the orientation angles of the current camera, in degrees.
 * <iframe width="100%" height="400" src="http://jsfiddle.net/iTownsIGN/okfj460p/embedded/" allowfullscreen="allowfullscreen" frameborder="0"></iframe>
 * @return {Array<number>}
 */
GlobeControls.prototype.getCameraOrientation = function getCameraOrientation() {
    var tiltCam = this.getTilt();
    var headingCam = this.getHeading();
    return [tiltCam, headingCam];
};

/**
 * Returns the camera location projected on the ground in lat,lon. See {@linkcode Coordinates} for conversion.
 * <iframe width="100%" height="400" src="http://jsfiddle.net/iTownsIGN/mjv7ha02/embedded/" allowfullscreen="allowfullscreen" frameborder="0"></iframe>
 * @return {Coordinates} position
 */

GlobeControls.prototype.getCameraLocation = function getCameraLocation() {
    return new Coordinates('EPSG:4978', this.camera.position).as('EPSG:4326');
};

/**
 * Retuns the {@linkcode Coordinates} of the central point on screen in lat,lon. See {@linkcode Coordinates} for conversion.
 * <iframe width="100%" height="400" src="http://jsfiddle.net/iTownsIGN/4tjgnv7z/embedded/" allowfullscreen="allowfullscreen" frameborder="0"></iframe>
 * @return {Position} position
 */

GlobeControls.prototype.getCameraTargetGeoPosition = function getCameraTargetGeoPosition() {
    return new Coordinates(this._view.referenceCrs, this.getCameraTargetPosition()).as('EPSG:4326');
};

/**
 * Sets the animation enabled.
 * @param      {boolean}  enable  enable
 */
GlobeControls.prototype.setAnimationEnabled = function setAnimationEnabled(enable) {
    enableAnimation = enable;
};

/**
 * Determines if animation enabled.
 * @return     {boolean}  True if animation enabled, False otherwise.
 */
GlobeControls.prototype.isAnimationEnabled = function isAnimationEnabled() {
    return enableAnimation;
};

/**
 * Returns the actual zoom. The zoom will always be between the [getMinZoom(), getMaxZoom()].
 * <iframe width="100%" height="400" src="http://jsfiddle.net/iTownsIGN/o3Lvanfe/embedded/" allowfullscreen="allowfullscreen" frameborder="0"></iframe>
 * @return     {number}  The zoom .
 */
GlobeControls.prototype.getZoom = function getZoom() {
    return computeTileZoomFromDistanceCamera(this.getRange(), this._view);
};

/**
 * Sets the current zoom, which is an index in the logical scales predefined for the application.
 * The higher the zoom, the closer to the ground.
 * The zoom is always in the [getMinZoom(), getMaxZoom()] range.
 * <iframe width="100%" height="400" src="http://jsfiddle.net/iTownsIGN/7cvno086/embedded/" allowfullscreen="allowfullscreen" frameborder="0"></iframe>
 * @param      {number}  zoom    The zoom
 * @param      {boolean}  isAnimated  Indicates if animated
 * @return     {Promise}
 */
GlobeControls.prototype.setZoom = function setZoom(zoom, isAnimated) {
    isAnimated = isAnimated === undefined ? this.isAnimationEnabled() : isAnimated;
    const range = computeDistanceCameraFromTileZoom(zoom, this._view);
    return this.setRange(range, isAnimated);
};

/**
 * Return the current zoom scale at the central point of the view.
 * This function compute the scale of a map
 * <iframe width="100%" height="400" src="http://jsfiddle.net/iTownsIGN/0p609qbu/embedded/" allowfullscreen="allowfullscreen" frameborder="0"></iframe>
 * @param      {number}  pitch   Screen pitch, in millimeters ; 0.28 by default
 * @return     {number}  The zoom scale.
 */
GlobeControls.prototype.getScale = function getScale(pitch) {
    // TODO: Why error div size height in Chrome?
    // Screen pitch, in millimeters
    pitch = (pitch || 0.28) / 1000;
    const FOV = sizeRendering.FOV / 180 * Math.PI * 0.5;
    // projection one unit on screen
    const unitProjection = sizeRendering.height / (2 * this.getRange() * Math.tan(FOV));
    return pitch * unitProjection;
};

/**
 * To convert the projection in meters on the globe of a number of pixels of screen
 * @param      {number} pixels count pixels to project
 * @param      {number} pixelPitch Screen pixel pitch, in millimeters (default = 0.28 mm / standard pixel size of 0.28 millimeters as defined by the OGC)
 * @return     {number} projection in meters on globe
 */
GlobeControls.prototype.pixelsToMeters = function pixelsToMeters(pixels, pixelPitch = 0.28) {
    const scaled = this.getScale(pixelPitch);
    const size = pixels * pixelPitch;
    return size / scaled / 1000;
};

/**
 * Projection on screen in pixels of length in meter on globe
 * @param      {number}  value Length in meter on globe
 * @param      {number}  pixelPitch Screen pixel pitch, in millimeters (default = 0.28 mm / standard pixel size of 0.28 millimeters as defined by the OGC)
 * @return     {number}  projection in pixels on screen
 */
GlobeControls.prototype.metersToPixels = function metersToPixels(value, pixelPitch = 0.28) {
    const scaled = this.getScale(pixelPitch);
    pixelPitch /= 1000;
    return value * scaled / pixelPitch;
};

/**
 * Changes the zoom of the central point of screen so that screen acts as a map with a specified scale.
 *  The view flies to the desired zoom scale;
 * <iframe width="100%" height="400" src="http://jsfiddle.net/iTownsIGN/0w4mfdb6/embedded/" allowfullscreen="allowfullscreen" frameborder="0"></iframe>
 * @param      {number}  scale  The scale
 * @param      {number}  pitch  The pitch
 * @param      {boolean}  isAnimated  Indicates if animated
 * @return     {Promise}
 */
 // TODO pas de scale supérieur à 0.05....
GlobeControls.prototype.setScale = function setScale(scale, pitch, isAnimated) {
    isAnimated = isAnimated === undefined ? this.isAnimationEnabled() : isAnimated;
    const range = getRangeFromScale(scale);
    return this.setRange(range, isAnimated);
};

/**
 * Changes the center of the scene on screen to the specified in lat, lon. See {@linkcode Coordinates} for conversion.
 * <iframe width="100%" height="400" src="http://jsfiddle.net/iTownsIGN/zrdgzz26/embedded/" allowfullscreen="allowfullscreen" frameborder="0"></iframe>
 * @function
 * @memberOf GlobeControls
 * @param {Object} coordinates - The globe coordinates in EPSG_4326 projection to aim to
 * @param {number} coordinates.latitude
 * @param {number} coordinates.longitude
 * @param {number} coordinates.range
 * @param {boolean}  isAnimated - if the movement should be animated
 * @return {Promise} A promise that resolves when the next 'globe initilazed' event fires.
 */
GlobeControls.prototype.setCameraTargetGeoPosition = function setCameraTargetGeoPosition(coordinates, isAnimated) {
    isAnimated = isAnimated === undefined ? this.isAnimationEnabled() : isAnimated;
    const position = new C.EPSG_4326(coordinates.longitude, coordinates.latitude, 0)
        .as('EPSG:4978').xyz();
    position.range = coordinates.range;
    return this.setCameraTargetPosition(position, isAnimated);
};

/**
 * Changes the center of the scene on screen to the specified in lat, lon. See {@linkcode Coordinates} for conversion.
 * This function allows to change the central position, the zoom, the range, the scale and the camera orientation at the same time.
 * The zoom has to be between the [getMinZoom(), getMaxZoom()].
 * Zoom parameter is ignored if range is set
 * Scale is ignored if range or Zoom is set.
 * <iframe width="100%" height="400" src="http://jsfiddle.net/iTownsIGN/9su6v2qz/embedded/" allowfullscreen="allowfullscreen" frameborder="0"></iframe>
 * @param {Position} position
 * @param {number}  position.longitude  Coordinate longitude WGS84 in degree
 * @param {number}  position.latitude  Coordinate latitude WGS84 in degree
 * @param {number}  [position.tilt]  Camera tilt in degree
 * @param {number}  [position.heading]  Camera heading in degree
 * @param {number}  [position.range]  The camera distance to the target center
 * @param {number}  [position.zoom]  zoom,  ignored if range is set
 * @param {number}  [position.scale]  scale,  ignored if the zoom or range is set. For a scale of 1/500 it is necessary to write 0,002.
 * @param {boolean}  isAnimated  Indicates if animated
 * @return {Promise}
 */
GlobeControls.prototype.setCameraTargetGeoPositionAdvanced = function setCameraTargetGeoPositionAdvanced(position, isAnimated) {
    isAnimated = isAnimated === undefined ? this.isAnimationEnabled() : isAnimated;
    if (position.zoom) {
        position.range = computeDistanceCameraFromTileZoom(position.zoom, this._view);
    } else if (position.scale) {
        position.range = getRangeFromScale(position.scale);
    }
    enableEventPositionChanged = false;
    return this.setCameraTargetGeoPosition(position, isAnimated).then(() => {
        enableEventPositionChanged = true;
        return this.setOrbitalPosition(position, isAnimated); });
};

/**
 * Pick a position on the globe at the given position in lat,lon. See {@linkcode Coordinates} for conversion.
 * @param {number | MouseEvent} mouse - The x-position inside the Globe element or a mouse event.
 * @param {number=} y - The y-position inside the Globe element.
 * @return {Coordinates} position
 */
GlobeControls.prototype.pickGeoPosition = function pickGeoPosition(mouse, y) {
    var screenCoords = {
        x: mouse.clientX || mouse,
        y: mouse.clientY || y,
    };

    var pickedPosition = this._view.getPickingPositionFromDepth(screenCoords);

    if (!pickedPosition) {
        return;
    }

    return new Coordinates('EPSG:4978', pickedPosition).as('EPSG:4326');
};

// # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #

GlobeControls.prototype.reset = function reset() {
    // TODO not reset target globe
    state = CONTROL_STATE.NONE;

    this.target.copy(initialTarget);
    this.camera.position.copy(initialPosition);
    this.camera.zoom = initialZoom;

    this.camera.updateProjectionMatrix();
    this._view.notifyChange(true);

    this.updateCameraTransformation();
};

export default GlobeControls;
