export function isInsidePolygon(point, polygon) {
    let inside = false;
    const x = point.lon;
    const y = point.lat;
    for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
        const currentPoint = polygon[index];
        const previousPoint = polygon[previous];
        const cross = (x - previousPoint[1]) * (currentPoint[0] - previousPoint[0]) -
            (y - previousPoint[0]) * (currentPoint[1] - previousPoint[1]);
        if (Math.abs(cross) < 1e-10 &&
            x >= Math.min(previousPoint[1], currentPoint[1]) && x <= Math.max(previousPoint[1], currentPoint[1]) &&
            y >= Math.min(previousPoint[0], currentPoint[0]) && y <= Math.max(previousPoint[0], currentPoint[0])) {
            return true;
        }
        const crosses = ((currentPoint[0] > y) !== (previousPoint[0] > y)) &&
            (x < (previousPoint[1] - currentPoint[1]) * (y - currentPoint[0]) /
                (previousPoint[0] - currentPoint[0]) + currentPoint[1]);
        if (crosses) inside = !inside;
    }
    return inside;
}
