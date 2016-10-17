/**
 * Generated On: 2016-01-20
 * Class: KML_Provider
 * Description: Parseur de KML jusqu'à obtention du collada
 */
/* global Promise*/

import Provider from 'Core/Commander/Providers/Provider';
import IoDriverXML from 'Core/Commander/Providers/IoDriverXML';
import * as THREE from 'THREE';
//import KMZLoader from 'Renderer/ThreeExtented/KMZLoader';
import FeatureToolBox from 'Renderer/ThreeExtented/FeatureToolBox';
import BasicMaterial from 'Renderer/BasicMaterial';
import togeojson from 'togeojson';


function KML_Provider(ellipsoid) {
    //Constructor
    this.ellipsoid = ellipsoid;
    this.ioDriverXML = new IoDriverXML();
  //  this.kmzLoader = new KMZLoader();
    this.cache = new Map();
    console.log(togeojson);
}

KML_Provider.prototype = Object.create(Provider.prototype);

KML_Provider.prototype.constructor = KML_Provider;

KML_Provider.prototype.loadKMZCenterInBBox = function( /*bbox*/ ) {

};

KML_Provider.prototype.parseKML = function(urlFile) {
    
    return this.ioDriverXML.read(urlFile).then(function(result) {
         var geojson = togeojson.kml(result);
         var objLinesPolyToRaster = new FeatureToolBox().extractFeatures(geojson); // Raster feat
         var geoFeat = new FeatureToolBox().createFeaturesPoints(geojson);//processingGeoJSON(geojson);            // vector feat
         //console.log(objLinesPolyToRaster);
         return {geoFeat: geoFeat, objLinesPolyToRaster: objLinesPolyToRaster};
        }.bind(this));
};

/*
KML_Provider.prototype.loadKMZ = function(longitude, latitude) {

    return this.getUrlCollada(longitude, latitude).then(function(result) {

        if (result === undefined)
            return undefined;

        if (result.scene.children[0]) {
            var child = result.scene.children[0];
            var coorCarto = result.coorCarto;

            var position = this.ellipsoid.cartographicToCartesian(coorCarto);
            coorCarto.altitude = 0;
            var normal = this.ellipsoid.geodeticSurfaceNormalCartographic(coorCarto);

            var quaternion = new THREE.Quaternion();
            quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);

            child.lookAt(new THREE.Vector3().addVectors(position, normal));
            child.quaternion.multiply(quaternion);
            child.position.copy(position);

            child.updateMatrix();
            child.visible = false;

            var changeMaterial = function(object3D) {

                if (object3D.material instanceof THREE.MultiMaterial) {
                    object3D.material = new BasicMaterial(object3D.material.materials[0].color);
                } else if (object3D.material)
                    object3D.material = new BasicMaterial(object3D.material.color);
            };


            child.traverse(changeMaterial);

            return child;
        }
        return undefined;

    }.bind(this));

};
*/



/*
// Parse KML As a tree specific for geoportail
KML_Provider.prototype.parseKML = function(urlFile, longitude, latitude) {


    var north = latitude;
    var south = latitude;
    var east = longitude;
    var west = longitude;
    var key = 'va5orxd0pgzvq3jxutqfuy0b';
    var url = 'http://wxs.ign.fr/' + key + '/vecteurtuile3d/BATI3D/' + 'FXX/';
    return this.ioDriverXML.read(urlFile).then(function(result) {

        var NetworkLink = [];
        NetworkLink = result.getElementsByTagName("NetworkLink");

        for (var i = 0; i < NetworkLink.length; i++) {

            var coords = [];
            coords[0] = NetworkLink[i].getElementsByTagName("north")[0].childNodes[0].nodeValue;
            coords[1] = NetworkLink[i].getElementsByTagName("south")[0].childNodes[0].nodeValue;
            coords[2] = NetworkLink[i].getElementsByTagName("east")[0].childNodes[0].nodeValue;
            coords[3] = NetworkLink[i].getElementsByTagName("west")[0].childNodes[0].nodeValue;


            if (north < coords[0] && south > coords[1] && east < coords[2] && west > coords[3]) {

                var href = [];
                href[i] = url + "TREE/" + NetworkLink[i].getElementsByTagName("href")[0].childNodes[0].nodeValue.replace("../", "");

                if (href[i].toLowerCase().substr(-4) === '.kml') {

                    return this.parseKML(href[i], longitude, latitude);

                }
                //Next level : Get the next KMZ actual position's coords
                else if (href[i].toLowerCase().substr(-4) === '.kmz') {

                    var url_kmz = url + NetworkLink[i].getElementsByTagName("href")[0].childNodes[0].nodeValue.replace("../../", "");
                    //url_kmz = "http://localhost:8383/kmz/BT_000092.kmz";

                    var p = this.cache[url_kmz];
                    if (!p) {
                        p = this.kmzLoader.load(url_kmz);
                        this.cache[url_kmz] = p;
                    }
                    return p;
                }
            }
        }

    }.bind(this));

};
*/

KML_Provider.prototype.getUrlCollada = function(longitude, latitude) {

    return this.ioDriverXML.read('http://wxs.ign.fr/va5orxd0pgzvq3jxutqfuy0b/vecteurtuile3d/BATI3D/BU.Building.kml').then(function( /*result_0*/ ) {

        // get href's node value
        //var kml_0 = result_0.getElementsByTagName("href");
        var url_href_1;
        var key = 'va5orxd0pgzvq3jxutqfuy0b';

        url_href_1 = 'http://wxs.ign.fr/' + key + '/vecteurtuile3d/BATI3D/FXX/TREE/0/0_000_000.kml';

        return this.parseKML(url_href_1, longitude, latitude);

    }.bind(this));
};

export default KML_Provider;
