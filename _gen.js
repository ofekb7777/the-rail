/* Garment renderer — draws recognisable clothing silhouettes on canvas so the
   colour-detection and cutout pipeline can be tested against something shaped
   like a real photo instead of a flat rectangle. Scratch file; folded into the
   app once it earns its place. */
(function(){

function shade(hex, amt){
  const n = parseInt(hex.slice(1),16);
  let r=(n>>16)&255, g=(n>>8)&255, b=n&255;
  r=Math.max(0,Math.min(255,Math.round(r+amt)));
  g=Math.max(0,Math.min(255,Math.round(g+amt)));
  b=Math.max(0,Math.min(255,Math.round(b+amt)));
  return 'rgb('+r+','+g+','+b+')';
}

/* Cloth needs a light side and a shadow side or the colour reads as a swatch. */
function drape(ctx, hex, x, y, w, h){
  const g = ctx.createLinearGradient(x, y, x+w, y+h);
  g.addColorStop(0,    shade(hex,  26));
  g.addColorStop(0.35, shade(hex,   6));
  g.addColorStop(0.62, shade(hex, -10));
  g.addColorStop(1,    shade(hex, -34));
  return g;
}

/* Weave: faint directional noise. Enough to defeat a flat-fill assumption in
   the colour sampler without shifting the average hue. */
function weave(ctx, x, y, w, h, strength){
  strength = strength || 0.05;
  ctx.save();
  ctx.globalAlpha = strength;
  for(let i=0;i<h;i+=3){
    ctx.fillStyle = i%6===0 ? '#fff' : '#000';
    ctx.fillRect(x, y+i, w, 1);
  }
  ctx.restore();
}

function ribbing(ctx, x, y, w, h, hex){
  ctx.save();
  ctx.fillStyle = shade(hex,-18);
  ctx.fillRect(x,y,w,h);
  ctx.globalAlpha = 0.35;
  for(let i=0;i<w;i+=4){
    ctx.fillStyle = shade(hex, i%8===0 ? 12 : -22);
    ctx.fillRect(x+i, y, 2, h);
  }
  ctx.restore();
}

const SHAPES = {};

SHAPES.shirt = function(ctx, hex, W, H, opt){
  const cx=W/2, top=H*0.20, bot=H*0.80;
  const shoulder=W*0.30, hem=W*0.26;
  ctx.fillStyle = drape(ctx,hex,cx-shoulder,top,shoulder*2,bot-top);
  /* sleeves */
  ctx.beginPath();
  ctx.moveTo(cx-shoulder, top+H*0.02);
  ctx.lineTo(cx-shoulder-W*0.14, top+H*(opt.shortSleeve?0.14:0.30));
  ctx.lineTo(cx-shoulder-W*0.05, top+H*(opt.shortSleeve?0.17:0.34));
  ctx.lineTo(cx-shoulder+W*0.02, top+H*0.10);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx+shoulder, top+H*0.02);
  ctx.lineTo(cx+shoulder+W*0.14, top+H*(opt.shortSleeve?0.14:0.30));
  ctx.lineTo(cx+shoulder+W*0.05, top+H*(opt.shortSleeve?0.17:0.34));
  ctx.lineTo(cx+shoulder-W*0.02, top+H*0.10);
  ctx.closePath(); ctx.fill();
  /* body, slightly tapered */
  ctx.beginPath();
  ctx.moveTo(cx-shoulder, top);
  ctx.lineTo(cx+shoulder, top);
  ctx.lineTo(cx+hem, bot);
  ctx.lineTo(cx-hem, bot);
  ctx.closePath(); ctx.fill();
  weave(ctx, cx-shoulder, top, shoulder*2, bot-top, 0.045);
  /* collar */
  ctx.fillStyle = shade(hex,-30);
  ctx.beginPath();
  ctx.moveTo(cx-W*0.10, top);
  ctx.lineTo(cx, top+H*0.09);
  ctx.lineTo(cx+W*0.10, top);
  ctx.lineTo(cx+W*0.05, top-H*0.015);
  ctx.lineTo(cx-W*0.05, top-H*0.015);
  ctx.closePath(); ctx.fill();
  /* placket */
  ctx.strokeStyle = shade(hex,-40); ctx.lineWidth = Math.max(1,W*0.006);
  ctx.beginPath(); ctx.moveTo(cx, top+H*0.09); ctx.lineTo(cx, bot); ctx.stroke();
  if(!opt.noButtons){
    ctx.fillStyle = shade(hex, 55);
    for(let i=0;i<4;i++){
      ctx.beginPath();
      ctx.arc(cx, top+H*(0.16+i*0.13), Math.max(1.2,W*0.011), 0, 7);
      ctx.fill();
    }
  }
};

SHAPES.tshirt = function(ctx,hex,W,H){
  SHAPES.shirt(ctx,hex,W,H,{shortSleeve:true, noButtons:true});
  /* crew neck over the placket the shirt drew */
  const cx=W/2, top=H*0.20;
  ctx.fillStyle = shade(hex,-26);
  ctx.beginPath(); ctx.ellipse(cx, top+H*0.012, W*0.105, H*0.032, 0, 0, 7); ctx.fill();
};

SHAPES.knit = function(ctx,hex,W,H){
  const cx=W/2, top=H*0.19, bot=H*0.79;
  const shoulder=W*0.325;
  ctx.fillStyle = drape(ctx,hex,cx-shoulder,top,shoulder*2,bot-top);
  ctx.beginPath();
  ctx.moveTo(cx-shoulder, top+H*0.02);
  ctx.lineTo(cx-shoulder-W*0.15, top+H*0.32);
  ctx.lineTo(cx-shoulder-W*0.04, top+H*0.36);
  ctx.lineTo(cx-shoulder+W*0.03, top+H*0.10);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx+shoulder, top+H*0.02);
  ctx.lineTo(cx+shoulder+W*0.15, top+H*0.32);
  ctx.lineTo(cx+shoulder+W*0.04, top+H*0.36);
  ctx.lineTo(cx+shoulder-W*0.03, top+H*0.10);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx-shoulder, top); ctx.lineTo(cx+shoulder, top);
  ctx.lineTo(cx+W*0.30, bot); ctx.lineTo(cx-W*0.30, bot);
  ctx.closePath(); ctx.fill();
  /* cable texture reads as knitwear */
  ctx.save(); ctx.globalAlpha=0.13; ctx.strokeStyle=shade(hex,-55);
  ctx.lineWidth=Math.max(1,W*0.012);
  for(let x=cx-shoulder+W*0.04; x<cx+shoulder; x+=W*0.055){
    ctx.beginPath(); ctx.moveTo(x, top+H*0.04); ctx.lineTo(x, bot-H*0.03); ctx.stroke();
  }
  ctx.restore();
  ribbing(ctx, cx-W*0.30, bot-H*0.05, W*0.60, H*0.05, hex);
  ctx.fillStyle = shade(hex,-30);
  ctx.beginPath(); ctx.ellipse(cx, top+H*0.015, W*0.115, H*0.035, 0, 0, 7); ctx.fill();
};

SHAPES.coat = function(ctx,hex,W,H,opt){
  const cx=W/2, top=H*0.13, bot=opt.short?H*0.66:H*0.90;
  const shoulder=W*0.33;
  ctx.fillStyle = drape(ctx,hex,cx-shoulder,top,shoulder*2,bot-top);
  ctx.beginPath();
  ctx.moveTo(cx-shoulder, top+H*0.02);
  ctx.lineTo(cx-shoulder-W*0.13, top+H*(opt.short?0.30:0.40));
  ctx.lineTo(cx-shoulder-W*0.02, top+H*(opt.short?0.34:0.44));
  ctx.lineTo(cx-shoulder+W*0.04, top+H*0.10);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx+shoulder, top+H*0.02);
  ctx.lineTo(cx+shoulder+W*0.13, top+H*(opt.short?0.30:0.40));
  ctx.lineTo(cx+shoulder+W*0.02, top+H*(opt.short?0.34:0.44));
  ctx.lineTo(cx+shoulder-W*0.04, top+H*0.10);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx-shoulder, top); ctx.lineTo(cx+shoulder, top);
  ctx.lineTo(cx+W*0.31, bot); ctx.lineTo(cx-W*0.31, bot);
  ctx.closePath(); ctx.fill();
  weave(ctx, cx-shoulder, top, shoulder*2, bot-top, 0.05);
  /* lapels */
  ctx.fillStyle = shade(hex,-32);
  ctx.beginPath();
  ctx.moveTo(cx-W*0.11, top); ctx.lineTo(cx, top+H*0.20);
  ctx.lineTo(cx-W*0.02, top+H*0.22); ctx.lineTo(cx-W*0.17, top+H*0.03);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx+W*0.11, top); ctx.lineTo(cx, top+H*0.20);
  ctx.lineTo(cx+W*0.02, top+H*0.22); ctx.lineTo(cx+W*0.17, top+H*0.03);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = shade(hex,-45); ctx.lineWidth=Math.max(1,W*0.006);
  ctx.beginPath(); ctx.moveTo(cx, top+H*0.20); ctx.lineTo(cx, bot); ctx.stroke();
  ctx.fillStyle = shade(hex,-60);
  for(let i=0;i<3;i++){
    ctx.beginPath();
    ctx.arc(cx-W*0.045, top+H*(0.26+i*0.15), Math.max(1.5,W*0.016), 0, 7); ctx.fill();
  }
};

SHAPES.trousers = function(ctx,hex,W,H,opt){
  const cx=W/2, top=H*0.16, bot=opt.shorts?H*0.56:H*0.92;
  const waist=W*0.22, leg=W*0.098, gap=W*0.022;
  ctx.fillStyle = drape(ctx,hex,cx-waist,top,waist*2,bot-top);
  ctx.beginPath();
  ctx.moveTo(cx-waist, top); ctx.lineTo(cx+waist, top);
  ctx.lineTo(cx+waist*0.92, top+H*0.16);
  ctx.lineTo(cx+leg+gap, bot); ctx.lineTo(cx+gap, bot);
  ctx.lineTo(cx, top+H*0.30);
  ctx.lineTo(cx-gap, bot); ctx.lineTo(cx-leg-gap, bot);
  ctx.lineTo(cx-waist*0.92, top+H*0.16);
  ctx.closePath(); ctx.fill();
  weave(ctx, cx-waist, top, waist*2, bot-top, 0.05);
  /* waistband */
  ctx.fillStyle = shade(hex,-26);
  ctx.fillRect(cx-waist, top, waist*2, H*0.035);
  if(opt.denim){
    ctx.save(); ctx.globalAlpha=0.5;
    ctx.strokeStyle='#d9b98a'; ctx.lineWidth=Math.max(1,W*0.005);
    ctx.setLineDash([W*0.012, W*0.012]);
    ctx.beginPath(); ctx.moveTo(cx-waist+W*0.02, top+H*0.04);
    ctx.lineTo(cx-waist+W*0.02, bot-H*0.02); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx+waist-W*0.02, top+H*0.04);
    ctx.lineTo(cx+waist-W*0.02, bot-H*0.02); ctx.stroke();
    /* pockets */
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(cx-waist+W*0.03, top+H*0.05);
    ctx.lineTo(cx-waist+W*0.10, top+H*0.11); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx+waist-W*0.03, top+H*0.05);
    ctx.lineTo(cx+waist-W*0.10, top+H*0.11); ctx.stroke();
    ctx.restore();
  }
};

SHAPES.skirt = function(ctx,hex,W,H){
  const cx=W/2, top=H*0.22, bot=H*0.74;
  ctx.fillStyle = drape(ctx,hex,cx-W*0.30,top,W*0.60,bot-top);
  ctx.beginPath();
  ctx.moveTo(cx-W*0.19, top); ctx.lineTo(cx+W*0.19, top);
  ctx.lineTo(cx+W*0.31, bot); ctx.lineTo(cx-W*0.31, bot);
  ctx.closePath(); ctx.fill();
  weave(ctx, cx-W*0.31, top, W*0.62, bot-top, 0.05);
  ctx.fillStyle = shade(hex,-26);
  ctx.fillRect(cx-W*0.19, top, W*0.38, H*0.035);
  /* pleats */
  ctx.save(); ctx.globalAlpha=0.16; ctx.strokeStyle=shade(hex,-60);
  ctx.lineWidth=Math.max(1,W*0.007);
  for(let i=-3;i<=3;i++){
    ctx.beginPath();
    ctx.moveTo(cx+i*W*0.05, top+H*0.04);
    ctx.lineTo(cx+i*W*0.082, bot);
    ctx.stroke();
  }
  ctx.restore();
};

SHAPES.dress = function(ctx,hex,W,H){
  const cx=W/2, top=H*0.17, waist=H*0.45, bot=H*0.85;
  ctx.fillStyle = drape(ctx,hex,cx-W*0.30,top,W*0.60,bot-top);
  ctx.beginPath();
  ctx.moveTo(cx-W*0.20, top); ctx.lineTo(cx+W*0.20, top);
  ctx.lineTo(cx+W*0.155, waist);
  ctx.lineTo(cx+W*0.32, bot); ctx.lineTo(cx-W*0.32, bot);
  ctx.lineTo(cx-W*0.155, waist);
  ctx.closePath(); ctx.fill();
  weave(ctx, cx-W*0.32, top, W*0.64, bot-top, 0.045);
  ctx.fillStyle = shade(hex,-28);
  ctx.beginPath(); ctx.ellipse(cx, top+H*0.008, W*0.115, H*0.03, 0, 0, 7); ctx.fill();
  ctx.fillStyle = shade(hex,-20);
  ctx.fillRect(cx-W*0.16, waist-H*0.012, W*0.32, H*0.024);
};

SHAPES.boot = function(ctx,hex,W,H){
  const cx=W/2, top=H*0.24, ankle=H*0.62, sole=H*0.80;
  ctx.fillStyle = drape(ctx,hex,cx-W*0.20,top,W*0.42,sole-top);
  ctx.beginPath();
  ctx.moveTo(cx-W*0.13, top); ctx.lineTo(cx+W*0.10, top);
  ctx.lineTo(cx+W*0.115, ankle);
  ctx.lineTo(cx+W*0.30, ankle+H*0.10);
  ctx.lineTo(cx+W*0.31, sole);
  ctx.lineTo(cx-W*0.15, sole);
  ctx.lineTo(cx-W*0.155, ankle);
  ctx.closePath(); ctx.fill();
  /* leather sheen */
  ctx.save(); ctx.globalAlpha=0.20;
  const sh = ctx.createLinearGradient(cx-W*0.10, top, cx+W*0.06, sole);
  sh.addColorStop(0,'rgba(255,255,255,0.85)');
  sh.addColorStop(0.4,'rgba(255,255,255,0)');
  ctx.fillStyle = sh;
  ctx.fillRect(cx-W*0.15, top, W*0.30, sole-top);
  ctx.restore();
  /* elastic gusset */
  ctx.fillStyle = shade(hex,-38);
  ctx.fillRect(cx+W*0.02, top+H*0.03, W*0.06, H*0.26);
  /* sole */
  ctx.fillStyle = shade(hex,-62);
  ctx.fillRect(cx-W*0.16, sole, W*0.48, H*0.045);
  ctx.fillStyle = shade(hex,-48);
  ctx.fillRect(cx-W*0.16, sole-H*0.012, W*0.48, H*0.014);
};

SHAPES.sneaker = function(ctx,hex,W,H){
  const cx=W/2, top=H*0.40, sole=H*0.70;
  ctx.fillStyle = drape(ctx,hex,cx-W*0.28,top,W*0.56,sole-top);
  ctx.beginPath();
  ctx.moveTo(cx-W*0.20, sole);
  ctx.quadraticCurveTo(cx-W*0.22, top+H*0.02, cx-W*0.02, top);
  ctx.lineTo(cx+W*0.06, top+H*0.01);
  ctx.quadraticCurveTo(cx+W*0.20, top+H*0.06, cx+W*0.30, sole);
  ctx.closePath(); ctx.fill();
  weave(ctx, cx-W*0.20, top, W*0.50, sole-top, 0.04);
  /* laces */
  ctx.strokeStyle = shade(hex, 62); ctx.lineWidth=Math.max(1,W*0.008);
  for(let i=0;i<4;i++){
    const y = top+H*0.03+i*H*0.055;
    ctx.beginPath();
    ctx.moveTo(cx-W*0.10+i*W*0.012, y);
    ctx.lineTo(cx+W*0.03+i*W*0.020, y-H*0.012);
    ctx.stroke();
  }
  /* midsole */
  ctx.fillStyle = shade(hex, 40);
  ctx.beginPath();
  ctx.moveTo(cx-W*0.21, sole-H*0.01);
  ctx.lineTo(cx+W*0.305, sole-H*0.01);
  ctx.lineTo(cx+W*0.30, sole+H*0.05);
  ctx.lineTo(cx-W*0.20, sole+H*0.05);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = shade(hex,-55);
  ctx.fillRect(cx-W*0.20, sole+H*0.038, W*0.505, H*0.016);
};

SHAPES.shoe = function(ctx,hex,W,H){
  const cx=W/2, top=H*0.46, sole=H*0.68;
  ctx.fillStyle = drape(ctx,hex,cx-W*0.26,top,W*0.52,sole-top);
  ctx.beginPath();
  ctx.moveTo(cx-W*0.18, sole);
  ctx.quadraticCurveTo(cx-W*0.19, top+H*0.01, cx-W*0.01, top);
  ctx.quadraticCurveTo(cx+W*0.19, top+H*0.05, cx+W*0.28, sole);
  ctx.closePath(); ctx.fill();
  ctx.save(); ctx.globalAlpha=0.26;
  const sh = ctx.createLinearGradient(cx-W*0.10, top, cx+W*0.10, sole);
  sh.addColorStop(0,'rgba(255,255,255,0.9)');
  sh.addColorStop(0.45,'rgba(255,255,255,0)');
  ctx.fillStyle=sh; ctx.fillRect(cx-W*0.20, top, W*0.40, sole-top);
  ctx.restore();
  ctx.strokeStyle = shade(hex,-45); ctx.lineWidth=Math.max(1,W*0.006);
  ctx.beginPath();
  ctx.moveTo(cx-W*0.04, top+H*0.012);
  ctx.quadraticCurveTo(cx+W*0.04, top+H*0.05, cx+W*0.02, top+H*0.085);
  ctx.stroke();
  ctx.fillStyle = shade(hex,-58);
  ctx.fillRect(cx-W*0.19, sole, W*0.475, H*0.032);
};

/* Backgrounds a phone photo actually lands on. The cutout has to cope with
   each of these, so they are worth testing against. */
const BACKDROPS = {
  studio: function(ctx,W,H){
    const g = ctx.createLinearGradient(0,0,0,H);
    g.addColorStop(0,'#ffffff'); g.addColorStop(0.7,'#f4f2ee'); g.addColorStop(1,'#e6e2da');
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  },
  wall: function(ctx,W,H){
    ctx.fillStyle='#d9d4c8'; ctx.fillRect(0,0,W,H);
    ctx.save(); ctx.globalAlpha=0.05;
    for(let i=0;i<400;i++){
      ctx.fillStyle = Math.random()>0.5?'#000':'#fff';
      ctx.fillRect(Math.random()*W, Math.random()*H, 2, 2);
    }
    ctx.restore();
  },
  wood: function(ctx,W,H){
    ctx.fillStyle='#8a6642'; ctx.fillRect(0,0,W,H);
    ctx.save(); ctx.globalAlpha=0.16;
    for(let y=0;y<H;y+=9){
      ctx.fillStyle = y%18===0?'#000':'#e8c9a0';
      ctx.fillRect(0,y,W,3);
    }
    ctx.restore();
  },
  bed: function(ctx,W,H){
    ctx.fillStyle='#cfd6dd'; ctx.fillRect(0,0,W,H);
    ctx.save(); ctx.globalAlpha=0.22; ctx.strokeStyle='#8fa0b2';
    ctx.lineWidth=6;
    for(let i=-2;i<8;i++){
      ctx.beginPath();
      ctx.moveTo(i*W*0.16, 0);
      ctx.quadraticCurveTo(i*W*0.16+W*0.06, H*0.5, i*W*0.16, H);
      ctx.stroke();
    }
    ctx.restore();
  },
  dark: function(ctx,W,H){
    const g = ctx.createRadialGradient(W/2,H*0.35,10,W/2,H/2,H*0.8);
    g.addColorStop(0,'#4a4a4e'); g.addColorStop(1,'#232326');
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  }
};

window.renderGarment = function(opts){
  const W = opts.size||512, H = opts.size||512;
  const c = document.createElement('canvas');
  c.width=W; c.height=H;
  const ctx = c.getContext('2d');

  (BACKDROPS[opts.backdrop] || BACKDROPS.studio)(ctx,W,H);

  /* contact shadow grounds the garment on the surface */
  ctx.save();
  ctx.globalAlpha=0.24;
  ctx.filter='blur(10px)';
  ctx.fillStyle='#000';
  ctx.beginPath(); ctx.ellipse(W/2+W*0.03, H*0.86, W*0.30, H*0.045, 0,0,7); ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.shadowColor='rgba(0,0,0,0.34)';
  ctx.shadowBlur=W*0.035;
  ctx.shadowOffsetX=W*0.012;
  ctx.shadowOffsetY=H*0.016;
  (SHAPES[opts.shape]||SHAPES.shirt)(ctx, opts.hex, W, H, opts.opt||{});
  ctx.restore();

  return c.toDataURL('image/jpeg', opts.quality||0.86);
};
window.GARMENT_SHAPES = Object.keys(SHAPES);
window.GARMENT_BACKDROPS = Object.keys(BACKDROPS);
console.log('renderGarment ready:', window.GARMENT_SHAPES.join(','));
})();
