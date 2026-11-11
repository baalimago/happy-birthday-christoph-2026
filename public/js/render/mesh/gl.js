// WebGL 2 helpers for the mesh renderer: programs that compile without stalling the page, and
// indexed meshes. A part never asks a program how its compile went; the renderer does, for all of
// them at once, when the driver says they are done.

/**
 * @typedef {object} Program
 * @property {WebGLProgram} program
 * @property {(name: string) => WebGLUniformLocation | null} at a uniform's location, looked up once
 */

/**
 * @typedef {object} Programs
 * @property {(vertex: string, fragment: string, attributes?: readonly string[]) => Program} make
 *   start compiling a program; `attributes` are bound to locations 0, 1, 2... in order
 * @property {() => 'pending' | 'ready' | 'failed'} ready
 * @property {() => void} dispose
 */

/**
 * @param {WebGL2RenderingContext} gl
 * @returns {Programs}
 */
export function createPrograms(gl) {
  /** @type {{ program: WebGLProgram, shaders: WebGLShader[] }[]} */
  const made = [];
  /** @type {'pending' | 'ready' | 'failed'} */
  let state = 'pending';
  return {
    make(vertex, fragment, attributes = []) {
      const program = gl.createProgram();
      if (!program) throw new Error('no program object');
      const shaders = [
        [gl.VERTEX_SHADER, vertex],
        [gl.FRAGMENT_SHADER, fragment],
      ].map(([type, source]) => {
        const shader = gl.createShader(/** @type {number} */ (type));
        if (!shader) throw new Error('no shader object');
        gl.shaderSource(shader, /** @type {string} */ (source));
        gl.compileShader(shader);
        gl.attachShader(program, shader);
        return shader;
      });
      attributes.forEach((name, index) => gl.bindAttribLocation(program, index, name));
      gl.linkProgram(program);
      made.push({ program, shaders });
      state = 'pending';
      /** @type {Map<string, WebGLUniformLocation | null>} */
      const found = new Map();
      return {
        program,
        at(name) {
          if (!found.has(name)) found.set(name, gl.getUniformLocation(program, name));
          return found.get(name) ?? null;
        },
      };
    },

    ready() {
      if (state !== 'pending' || gl.isContextLost()) return state;
      const parallel = gl.getExtension('KHR_parallel_shader_compile');
      for (const { program } of made) {
        if (parallel && !gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR)) {
          return 'pending';
        }
      }
      state = 'ready';
      for (const { program, shaders } of made) {
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
          if (gl.isContextLost()) return (state = 'pending');
          const logs = [
            ...shaders.map((s) => gl.getShaderInfoLog(s)),
            gl.getProgramInfoLog(program),
          ];
          console.warn('The sea could not be drawn.', logs.filter(Boolean).join('\n'));
          state = 'failed';
        }
        for (const shader of shaders) gl.deleteShader(shader);
        shaders.length = 0;
      }
      return state;
    },

    dispose() {
      for (const { program, shaders } of made) {
        for (const shader of shaders) gl.deleteShader(shader);
        gl.deleteProgram(program);
      }
      made.length = 0;
    },
  };
}

/**
 * @typedef {object} Mesh
 * @property {WebGLVertexArrayObject} vao
 * @property {number} count indices (or vertices, without an index) to draw
 * @property {boolean} indexed
 * @property {(instances?: number) => void} draw bind and draw the triangles
 * @property {() => void} dispose
 */

/**
 * Upload a mesh. Each entry of `attributes` is one vertex attribute, at the location of its place
 * in the list; `divisor: 1` makes it one value per instance.
 * @param {WebGL2RenderingContext} gl
 * @param {readonly { data: Float32Array, size: number, divisor?: number }[]} attributes
 * @param {Uint16Array | Uint32Array} [index]
 * @returns {Mesh}
 */
export function createMesh(gl, attributes, index) {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error('no vertex array object');
  gl.bindVertexArray(vao);
  /** @type {(WebGLBuffer | null)[]} */
  const buffers = [];
  attributes.forEach(({ data, size, divisor }, location) => {
    const buffer = gl.createBuffer();
    buffers.push(buffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    if (divisor) gl.vertexAttribDivisor(location, divisor);
  });
  if (index) {
    const buffer = gl.createBuffer();
    buffers.push(buffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index, gl.STATIC_DRAW);
  }
  gl.bindVertexArray(null);
  const first = attributes.find((attribute) => !attribute.divisor) ?? attributes[0];
  const count = index ? index.length : first.data.length / first.size;
  const type = index instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
  return {
    vao,
    count,
    indexed: Boolean(index),
    draw(instances) {
      gl.bindVertexArray(vao);
      if (instances === undefined) {
        if (index) gl.drawElements(gl.TRIANGLES, count, type, 0);
        else gl.drawArrays(gl.TRIANGLES, 0, count);
      } else if (instances > 0) {
        if (index) gl.drawElementsInstanced(gl.TRIANGLES, count, type, 0, instances);
        else gl.drawArraysInstanced(gl.TRIANGLES, 0, count, instances);
      }
    },
    dispose() {
      gl.deleteVertexArray(vao);
      for (const buffer of buffers) gl.deleteBuffer(buffer);
    },
  };
}
