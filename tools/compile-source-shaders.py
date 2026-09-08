"""Read expanded shader pairs on stdin; compile/link with local surfaceless Mesa GLES3."""
import ctypes as C, json, os, sys
os.environ['EGL_PLATFORM']='surfaceless'
os.environ['LIBGL_ALWAYS_SOFTWARE']='1'
e=C.CDLL('libEGL.so.1'); g=C.CDLL('libGLESv2.so.2')
P=C.c_void_p; I=C.c_int; U=C.c_uint

def fn(lib,name,restype,args):
    f=getattr(lib,name); f.restype=restype; f.argtypes=args; return f
getdisplay=fn(e,'eglGetDisplay',P,[P]); d=getdisplay(None)
assert fn(e,'eglInitialize',U,[P,P,P])(d,None,None)
assert fn(e,'eglBindAPI',U,[U])(0x30A0)
attrs=(I*11)(0x3024,8,0x3023,8,0x3022,8,0x3040,0x40,0x3033,1,0x3038)
config=P(); count=I()
assert fn(e,'eglChooseConfig',U,[P,P,P,I,P])(d,attrs,C.byref(config),1,C.byref(count)) and count.value
ctx=fn(e,'eglCreateContext',P,[P,P,P,P])(d,config,None,(I*3)(0x3098,3,0x3038))
assert ctx
assert fn(e,'eglMakeCurrent',U,[P,P,P,P])(d,None,None,ctx)
print('Renderer:',fn(g,'glGetString',C.c_char_p,[U])(0x1F01).decode())
create=fn(g,'glCreateShader',U,[U]); source=fn(g,'glShaderSource',None,[U,I,P,P]); compile_=fn(g,'glCompileShader',None,[U])
status=fn(g,'glGetShaderiv',None,[U,U,P]); log=fn(g,'glGetShaderInfoLog',None,[U,I,P,P])
createp=fn(g,'glCreateProgram',U,[]); attach=fn(g,'glAttachShader',None,[U,U]); link=fn(g,'glLinkProgram',None,[U])
statusp=fn(g,'glGetProgramiv',None,[U,U,P]); logp=fn(g,'glGetProgramInfoLog',None,[U,I,P,P])
shaders=json.load(sys.stdin)
for pair in shaders:
    program=createp()
    for stage,typ in [('vertex',0x8B31),('fragment',0x8B30)]:
        sh=create(typ); data=C.c_char_p(pair[stage].encode()); source(sh,1,C.byref(data),None); compile_(sh)
        ok=I(); status(sh,0x8B81,C.byref(ok))
        if not ok.value:
            text=C.create_string_buffer(65536); log(sh,65536,None,text)
            raise RuntimeError(pair['name']+' '+stage+'\n'+text.value.decode())
        attach(program,sh)
    link(program); ok=I(); statusp(program,0x8B82,C.byref(ok))
    if not ok.value:
        text=C.create_string_buffer(65536); logp(program,65536,None,text); raise RuntimeError(text.value.decode())
    print('PASS',pair['name'])
print(f'{len(shaders)} Phong programs compiled and linked')
