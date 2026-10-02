import { calculateDistance } from './geoUtils.ts';

export interface GraphEdge { toNodeId: string; weight: number; }
export interface GraphNode { id: string; lat: number; lng: number; edges: GraphEdge[]; }
export interface NetworkSegment { startNodeId: string; endNodeId: string; }

/** A graph whose edges are exclusively segments from the processed walking network. */
export class RoutingGraph {
  public nodes = new Map<string, GraphNode>();
  public segments: NetworkSegment[] = [];
  public error: string | null = null;
  private readonly stitchToleranceMeters = 4;

  public getNodeId(lat: number, lng: number) { return `${lat.toFixed(7)},${lng.toFixed(7)}`; }

  public addNode(lat: number, lng: number) {
    const id = this.getNodeId(lat, lng);
    if (!this.nodes.has(id)) this.nodes.set(id, { id, lat, lng, edges: [] });
    return id;
  }

  public addEdge(id1: string, id2: string, weight: number) {
    if (id1 === id2 || !Number.isFinite(weight)) return;
    const node1 = this.nodes.get(id1);
    const node2 = this.nodes.get(id2);
    if (!node1 || !node2) return;
    if (!node1.edges.some((edge) => edge.toNodeId === id2)) node1.edges.push({ toNodeId: id2, weight });
    if (!node2.edges.some((edge) => edge.toNodeId === id1)) node2.edges.push({ toNodeId: id1, weight });
  }

  public buildFromGeoJSON(features: unknown): boolean {
    this.nodes.clear(); this.segments = []; this.error = null;
    if (!Array.isArray(features) || features.length === 0) {
      this.error = 'The processed walking network is empty.';
      return false;
    }
    for (const feature of features as any[]) {
      const coordinates = feature?.geometry?.type === 'LineString' ? feature.geometry.coordinates : null;
      if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
      let previousId: string | null = null;
      for (const coordinate of coordinates) {
        const [lng, lat] = coordinate ?? [];
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const id = this.addNode(lat, lng);
        if (previousId) {
          const previous = this.nodes.get(previousId)!;
          const distance = calculateDistance(previous.lat, previous.lng, lat, lng);
          if (distance > 0.02) { this.addEdge(previousId, id, distance); this.segments.push({ startNodeId: previousId, endNodeId: id }); }
        }
        previousId = id;
      }
    }
    if (this.segments.length === 0) { this.error = 'The processed walking network has no valid path segments.'; return false; }
    // Recorded paths can meet with a small GPS offset. This stitches only nearby recorded vertices.
    const nodes = [...this.nodes.values()];
    for (let index = 0; index < nodes.length; index += 1) for (let candidate = index + 1; candidate < nodes.length; candidate += 1) {
      const distance = calculateDistance(nodes[index].lat, nodes[index].lng, nodes[candidate].lat, nodes[candidate].lng);
      if (distance > 0.02 && distance <= this.stitchToleranceMeters) this.addEdge(nodes[index].id, nodes[candidate].id, distance);
    }
    return true;
  }

  public cloneNodes() {
    return new Map([...this.nodes].map(([id, node]) => [id, { ...node, edges: node.edges.map((edge) => ({ ...edge })) }]));
  }
}
