function pointIsOverLine(point, linePoints, precision) {
    const x0 = point._values[0];
    const y0 = point._values[1];
    // in first j is last point of line and then it'll be (i - 1)
    for (var i = 0, j = linePoints.length - 1; i < linePoints.length; j = i++) {
        const x1 = linePoints[i]._values[0];
        const y1 = linePoints[i]._values[1];
        const x2 = linePoints[j]._values[0];
        const y2 = linePoints[j]._values[1];

        const Xp = x0 - x1;
        const Yp = y0 - y1;

        const x21 = x2 - x1;
        const y21 = y2 - y1;
        const n = Math.sqrt(x21 * x21 + y21 * y21);
        const scalar = (Xp * x21 + Yp * y21) / n;

        if (scalar >= -precision && scalar <= n + precision) {
            const distance = Math.abs(y21 * x0 - x21 * y0 + x2 * y1 - y2 * x1) / n;
            if (distance <= precision) {
                return true;
            }
        }
    }

    return false;
}

function getClosestPointIndice(point, points, precision) {
    const x0 = point._values[0];
    const y0 = point._values[1];
    for (var i = 0; i < points.length; ++i) {
        const x1 = points[i]._values[0];
        const y1 = points[i]._values[1];
        const xP = x0 - x1;
        const yP = y0 - y1;
        const n = Math.sqrt(xP * xP + yP * yP);
        if (n < precision) {
            return i;
        }
    }
}

function pointIsInsidePolygon(point, polygonPoints) {
    // ray-casting algorithm based on
    // http://www.ecse.rpi.edu/Homepages/wrf/Research/Short_Notes/pnpoly.html

    const x = point._values[0];
    const y = point._values[1];

    let inside = false;
    // in first j is last point of polygon and then it'll be (i - 1)
    for (let i = 0, j = polygonPoints.length - 1; i < polygonPoints.length; j = i++) {
        const xi = polygonPoints[i]._values[0];
        const yi = polygonPoints[i]._values[1];
        const xj = polygonPoints[j]._values[0];
        const yj = polygonPoints[j]._values[1];

        // isIntersect semi-infinite ray horizontally with polygon's edge
        const isIntersect = ((yi > y) != (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (isIntersect) {
            inside = !inside;
        }
    }

    return inside;
}


function getFeatureAtCoordinate(coordinate, feature, coordinates, precision, properties, result) {
    if (feature.type == 'linestring' && pointIsOverLine(coordinate, coordinates, precision)) {
        result.lines.push({ properties, coordinates });
    } else if (feature.type == 'polygon' && pointIsInsidePolygon(coordinate, coordinates)) {
        result.polygons.push({ properties, coordinates });
    } else if (feature.type == 'point') {
        const indice = getClosestPointIndice(coordinate, coordinates, precision);
        if (indice != undefined) {
            result.points.push({ properties, coordinates: coordinates[indice] });
        }
    }
}
export default {
    /**
     * filters the features that are under the coordinate
     *
     * @param      {Coordinates}  coordinate  the coordinate for the filter condition
     * @param      {Features}  collection  features collection to filter
     * @param      {number}  precision  tolerance around the coordinate
     * @return     {array}  array of filters features
     */
    getFeaturesAtCoordinate(coordinate, collection, precision = 0.1) {
        const result = { points: [], lines: [], polygons: [] };
        if (collection.geometries) {
            if (collection.extent && !collection.extent.isPointInside(coordinate, precision)) {
                return result;
            }
            for (const features of collection.geometries) {
                if (features.extent && !features.extent.isPointInside(coordinate, precision)) {
                    continue;
                }
                /* eslint-disable guard-for-in */
                for (const id in features.featureVertices) {
                    const polygon = features.featureVertices[id];
                    if (polygon.extent && !polygon.extent.isPointInside(coordinate, precision)) {
                        continue;
                    }
                    const properties = collection.features[id].properties.properties;
                    const coordinates = features.coordinates.slice(polygon.offset, polygon.offset + polygon.count);
                    getFeatureAtCoordinate(coordinate, features, coordinates, precision, properties, result);
                }
            }
        } else if (collection.geometry) {
            if (collection.geometry.extent && !collection.geometry.extent.isPointInside(coordinate, precision)) {
                return result;
            }
            getFeatureAtCoordinate(coordinate, collection.geometry, collection.geometry.coordinates, precision, collection.properties.properties, result);
        }
        return result;
    },
};
