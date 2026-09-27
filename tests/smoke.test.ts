import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

describe('toolchain', () => {
  it('runs against three r186', () => {
    expect(THREE.REVISION).toBe('186');
  });
});
