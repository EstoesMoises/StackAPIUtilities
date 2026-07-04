export interface InteractionEdge {
  source: string;
  target: string;
  weight: number;
}

export function buildInteractionSummary(edges: InteractionEdge[]) {
  const copiedEdges = edges.map((edge) => ({ ...edge }));
  const nodes = [...new Set(edges.flatMap((edge) => [edge.source, edge.target]))].sort();
  return {
    totalInteractions: copiedEdges.reduce((sum, edge) => sum + edge.weight, 0),
    nodes,
    edges: copiedEdges,
    topEdges: [...copiedEdges].sort((a, b) => b.weight - a.weight).slice(0, 10),
  };
}
