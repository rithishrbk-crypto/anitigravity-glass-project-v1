import { RoutingGraph } from './graph.ts';
import type { GraphNode } from './graph.ts';
import { calculateDistance, snapToSegment } from './geoUtils.ts';

export interface NetworkMatch { lat: number; lng: number; distance: number; startNodeId: string; endNodeId: string; }
export interface RouteResult {
  path: { lat: number; lng: number }[];
  distance: number;
  found: boolean;
  startMatch: NetworkMatch | null;
  destinationMatch: NetworkMatch | null;
  error?: string;
}

const noRoute = (error: string, startMatch: NetworkMatch | null = null, destinationMatch: NetworkMatch | null = null): RouteResult =>
  ({ path: [], distance: 0, found: false, startMatch, destinationMatch, error });

export class RouteEngine {
  private readonly graph: RoutingGraph;

  constructor(graph: RoutingGraph) { this.graph = graph; }

  public findNearestNetworkPoint(lat: number, lng: number): NetworkMatch | null {
    let closest: NetworkMatch | null = null;
    for (const segment of this.graph.segments) {
      const start = this.graph.nodes.get(segment.startNodeId);
      const end = this.graph.nodes.get(segment.endNodeId);
      if (!start || !end) continue;
      const snapped = snapToSegment(lat, lng, start.lat, start.lng, end.lat, end.lng);
      if (!closest || snapped.distance < closest.distance) closest = { ...snapped, startNodeId: start.id, endNodeId: end.id };
    }
    return closest;
  }

  private addMatchedPoint(nodes: Map<string, GraphNode>, match: NetworkMatch, label: string) {
    const id = `${label}:${match.lat.toFixed(8)},${match.lng.toFixed(8)}`;
    const start = nodes.get(match.startNodeId);
    const end = nodes.get(match.endNodeId);
    if (!start || !end) return null;
    nodes.set(id, { id, lat: match.lat, lng: match.lng, edges: [] });
    const add = (from: string, to: string, weight: number) => {
      nodes.get(from)!.edges.push({ toNodeId: to, weight });
      nodes.get(to)!.edges.push({ toNodeId: from, weight });
    };
    add(id, start.id, calculateDistance(match.lat, match.lng, start.lat, start.lng));
    add(id, end.id, calculateDistance(match.lat, match.lng, end.lat, end.lng));
    return id;
  }

  public calculateRoute(startLat: number, startLng: number, destinationLat: number, destinationLng: number, maxSnapDistanceMeters: number): RouteResult {
    if (this.graph.error) return noRoute(this.graph.error);
    const startMatch = this.findNearestNetworkPoint(startLat, startLng);
    const destinationMatch = this.findNearestNetworkPoint(destinationLat, destinationLng);
    if (!startMatch || !destinationMatch) return noRoute('No valid walking path was found.', startMatch, destinationMatch);
    if (startMatch.distance > maxSnapDistanceMeters) return noRoute('You are outside the recorded campus walking network.', startMatch, destinationMatch);
    if (destinationMatch.distance > maxSnapDistanceMeters) return noRoute('The destination is not connected to the recorded walking network.', startMatch, destinationMatch);
    if (startMatch.startNodeId === destinationMatch.startNodeId && startMatch.endNodeId === destinationMatch.endNodeId) {
      return { path: [{ lat: startMatch.lat, lng: startMatch.lng }, { lat: destinationMatch.lat, lng: destinationMatch.lng }], distance: calculateDistance(startMatch.lat, startMatch.lng, destinationMatch.lat, destinationMatch.lng), found: true, startMatch, destinationMatch };
    }

    const nodes = this.graph.cloneNodes();
    const startId = this.addMatchedPoint(nodes, startMatch, 'start');
    const destinationId = this.addMatchedPoint(nodes, destinationMatch, 'destination');
    if (!startId || !destinationId) return noRoute('Unable to connect the route to the walking network.', startMatch, destinationMatch);
    const distances = new Map<string, number>([...nodes.keys()].map((id) => [id, Infinity]));
    const previous = new Map<string, string>();
    const pending = new Set(nodes.keys());
    distances.set(startId, 0);
    while (pending.size) {
      let currentId: string | null = null; let best = Infinity;
      for (const id of pending) { const distance = distances.get(id)!; if (distance < best) { best = distance; currentId = id; } }
      if (!currentId || best === Infinity) break;
      pending.delete(currentId);
      if (currentId === destinationId) break;
      for (const edge of nodes.get(currentId)!.edges) {
        if (!pending.has(edge.toNodeId)) continue;
        const candidate = best + edge.weight;
        if (candidate < distances.get(edge.toNodeId)!) { distances.set(edge.toNodeId, candidate); previous.set(edge.toNodeId, currentId); }
      }
    }
    if (distances.get(destinationId) === Infinity) return noRoute('The destination is unreachable on the recorded walking network.', startMatch, destinationMatch);
    const path: { lat: number; lng: number }[] = [];
    for (let id: string | undefined = destinationId; id; id = previous.get(id)) { const node = nodes.get(id)!; path.unshift({ lat: node.lat, lng: node.lng }); }
    return { path, distance: distances.get(destinationId)!, found: true, startMatch, destinationMatch };
  }
}
