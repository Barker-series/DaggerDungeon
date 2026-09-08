"""Exercise the real finish GLSL in a one-pixel float target on local Mesa."""
import runpy
s = runpy.run_path('tools/compile-source-shaders.py')
g, fn, C, U, I, P = (s[k] for k in ('g', 'fn', 'C', 'U', 'I', 'P'))
F = C.c_float
program = s['program']
fn(g, 'glUseProgram', None, [U])(program)
fbo, tex = U(), U()
fn(g, 'glGenFramebuffers', None, [I, P])(1, C.byref(fbo))
fn(g, 'glBindFramebuffer', None, [U, U])(0x8D40, fbo)
fn(g, 'glGenTextures', None, [I, P])(1, C.byref(tex))
fn(g, 'glBindTexture', None, [U, U])(0x0DE1, tex)
fn(g, 'glTexImage2D', None, [U, I, I, I, I, I, U, U, P])(0x0DE1, 0, 0x8814, 1, 1, 0, 0x1908, 0x1406, None)
fn(g, 'glFramebufferTexture2D', None, [U, U, U, U, I])(0x8D40, 0x8CE0, 0x0DE1, tex, 0)
assert fn(g, 'glCheckFramebufferStatus', U, [U])(0x8D40) == 0x8CD5
fn(g, 'glViewport', None, [I, I, I, I])(0, 0, 1, 1)
loc = fn(g, 'glGetUniformLocation', I, [U, C.c_char_p])
uniform = fn(g, 'glUniform1f', None, [I, F])
color = fn(g, 'glUniform4f', None, [I, F, F, F, F])
draw = fn(g, 'glDrawArrays', None, [U, I, I])
read = fn(g, 'glReadPixels', None, [I, I, I, I, U, U, P])
def render(rgb, contrast):
    uniform(loc(program, b'contrast'), contrast)
    uniform(loc(program, b'saturation'), 1)
    uniform(loc(program, b'vignette'), 0)
    color(loc(program, b'probeColor'), *rgb, 1)
    draw(0x0004, 0, 3)
    out = (F * 4)()
    read(0, 0, 1, 1, 0x1908, 0x1406, out)
    return list(out)[:3]
for contrast in (1.04, 0.8, 1, 1.2):
    for rgb in ((0.008568, 0.01096, 0.011612), (0, 0, 0), (0.00001, 0.00002, 0.00003), (0.03, 0.05, 0.07), (0.18, 0.18, 0.18), (1, 2, 4)):
        out = render(rgb, contrast)
        if rgb == (0, 0, 0):
            assert out == [0, 0, 0], (contrast, rgb, out, 'true black must stay black')
        else:
            assert all(c > 0 for c in out), (contrast, rgb, out, 'lit detail must not clip to black')
            for i in (1, 2):
                assert abs(out[i] / out[0] - rgb[i] / rgb[0]) < 0.0001, (contrast, rgb, out, 'contrast preserves hue')
        if contrast == 1 or rgb == (0.18, 0.18, 0.18):
            assert all(abs(a-b) < 1e-6 for a,b in zip(rgb,out)), (contrast, rgb, out)
print('PASS real GLSL float readback: 24 dark/HDR/black probes, custom contrast, hue and middle-gray anchor')
