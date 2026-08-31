import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { graphStore, GraphStore } from '../src/graph';
import { graphRouter } from '../src/routes/graph';
import { sampleRows } from './fixtures/images';

const app = express();
app.use('/api/graph', graphRouter);

beforeAll(() => {
  graphStore.load(sampleRows);
});

afterAll(() => {
  graphStore.stop();
});

describe('GET /api/graph', () => {
  it('returns nodes and edges', async () => {
    const res = await request(app).get('/api/graph');
    expect(res.status).toBe(200);
    expect(res.body.nodes).toBeInstanceOf(Array);
    expect(res.body.edges).toBeInstanceOf(Array);
    expect(res.body.nodes.length).toBeGreaterThan(0);
    expect(res.body.edges.length).toBeGreaterThan(0);
  });

  it('node has correct shape', async () => {
    const res = await request(app).get('/api/graph');
    const node = res.body.nodes[0];
    expect(node).toHaveProperty('id');
    expect(node).toHaveProperty('type');
    expect(node).toHaveProperty('label');
    expect(node).toHaveProperty('size');
    expect(node).toHaveProperty('color');
    expect(['image', 'tag', 'style', 'mood', 'useCase', 'color']).toContain(node.type);
  });

  it('edge has correct shape', async () => {
    const res = await request(app).get('/api/graph');
    const edge = res.body.edges[0];
    expect(edge).toHaveProperty('source');
    expect(edge).toHaveProperty('target');
    expect(edge).toHaveProperty('type');
    expect(edge).toHaveProperty('weight');
  });

  it('filters by type', async () => {
    const res = await request(app).get('/api/graph?types=tag');
    expect(res.status).toBe(200);
    for (const node of res.body.nodes) {
      expect(node.type).toBe('tag');
    }
  });

  it('respects limit', async () => {
    const res = await request(app).get('/api/graph?limit=5');
    expect(res.status).toBe(200);
    expect(res.body.nodes.length).toBeLessThanOrEqual(5);
  });

  it('returns ego graph for center', async () => {
    const firstImg = sampleRows[0].id;
    const res = await request(app).get(`/api/graph?center=${firstImg}&hops=1`);
    expect(res.status).toBe(200);
    expect(res.body.nodes.length).toBeGreaterThan(0);
    // Center node should be in the results.
    const ids = res.body.nodes.map((n: any) => n.id);
    expect(ids).toContain(firstImg);
  });

  it('returns empty when no types match', async () => {
    const res = await request(app).get('/api/graph?types=nonexistent');
    expect(res.status).toBe(200);
    expect(res.body.nodes).toEqual([]);
  });
});
