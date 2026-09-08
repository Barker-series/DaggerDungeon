"""Actual legacy textures + exact TS slab reference; neutral flat-light swatches."""
import json, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
settings = json.load(sys.stdin)
factors = settings['factors']
w, h = 480, 360
out = Image.new('RGB', (1480, 870), '#1b2025')
draw = ImageDraw.Draw(out)
font = ImageFont.truetype('/usr/share/fonts/google-noto-vf/NotoSans[wght].ttf', 19) if Path('/usr/share/fonts/google-noto-vf/NotoSans[wght].ttf').exists() else ImageFont.load_default(size=19)
def linear(v):
    v /= 255
    return v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4
def srgb(v):
    return round(255 * (12.92*v if v <= .0031308 else 1.055*v**(1/2.4)-.055))
roles = [('OLD CLEAN WALL', 'concrete-clean-base.png', None), ('CONCRETE SLABS / 3 x 6 metres', 'concrete-smooth-precast.png', None), ('QUIET CEILING / relief 0.006', 'concrete-clean-base.png', None), ('NATURAL MINERAL / no slab grid', 'concrete-fine-aggregate.png', None), ('PAINT / example service coat', 'source/painted-metal-packed.webp', (.28,.39,.43)), ('FITTING / original worn iron', 'source/rusted-metal-packed.webp', None)]
for i, (title, asset, coat) in enumerate(roles):
    tex = Image.open(Path('public/textures') / asset).convert('RGB').resize((120,90), Image.Resampling.LANCZOS)
    panel = Image.new('RGB', (w,h))
    for y in range(h):
        for x in range(w):
            rgb = [linear(v) for v in tex.getpixel((x%120,y%90))]
            if coat:
                value = sum(a*b for a,b in zip(rgb,(.2126,.7152,.0722))) * 4096
                low = min(4095, int(value)); blend = value-low
                lut = settings['metal']['painted-metal' if i == 4 else 'rusted-metal']
                wear = lut[low]*(1-blend)+lut[low+1]*blend
                rgb = [wear*c for c in coat]
            elif i == 1:
                rgb = [v*factors[y][x] for v in rgb]
            panel.putpixel((x,y),tuple(srgb(v) for v in rgb))
    px, py = 10 + (i%3)*490, 65 + (i//3)*400
    out.paste(panel,(px,py)); draw.text((px,py-27),title,fill='#e7eaed',font=font)
draw.text((10,825),'Software swatches: actual assets, linear RGB; exact slab CPU reference. Not an in-engine lighting/geometry capture.',font=font,fill='#d0d5da')
path=Path('artifacts/quiet-material-roles.png'); path.parent.mkdir(exist_ok=True); out.save(path)
print(path)
