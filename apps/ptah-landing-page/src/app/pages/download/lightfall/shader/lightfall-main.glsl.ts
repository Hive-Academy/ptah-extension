/** mainImage: beam, flare, wisps and fog composed into one colour. Part of LIGHTFALL_FRAGMENT (see lightfall-shader.ts). */
export const LIGHTFALL_MAIN = `
void mainImage(out vec4 fc,in vec2 frag){
vec2 C = vec2(iResolution.x * 0.5, 0.0); float invW=1.0/max(C.x,1.0);
float sc=512.0/iResolution.x*.4;
vec2 uv=(frag-C)*sc,off=vec2(uBeamXFrac*iResolution.x*sc,uBeamYFrac*iResolution.y*sc);
vec2 uvc = uv - off;
float a=0.0,b=0.0;
float basePhase=1.5*PI+uDecay*.5; float tauMin=basePhase-uDecay; float tauMax=basePhase;
float cx=clamp(uvc.x/(R_H*uHLenFactor),-1.0,1.0),tH=clamp(TWO_PI-acos(cx),tauMin,tauMax);
for(int k=-TAP_RADIUS;k<=TAP_RADIUS;++k){
float tu=tH+float(k)*DT_LOCAL,wt=tauWf(tu,tauMin,tauMax); if(wt<=0.0) continue;
float spd=max(abs(sin(tu)),0.02),u=clamp((basePhase-tu)/max(uDecay,EPS),0.0,1.0),env=pow(1.0-abs(u*2.0-1.0),0.8);
vec2 p=vec2((R_H*uHLenFactor)*cos(tu),0.0);
a+=wt*bs(uvc,p,env*spd);
}
float yPix=uvc.y,cy=clamp(-yPix/(R_V*uVLenFactor),-1.0,1.0),tV=clamp(TWO_PI-acos(cy),tauMin,tauMax);
for(int k=-TAP_RADIUS;k<=TAP_RADIUS;++k){
float tu=tV+float(k)*DT_LOCAL,wt=tauWf(tu,tauMin,tauMax); if(wt<=0.0) continue;
float yb=(-R_V)*cos(tu),s=clamp(yb/R_V,0.0,1.0),spd=max(abs(sin(tu)),0.02);
float env=pow(1.0-s,0.6)*spd;
float cap=1.0-smoothstep(TOP_FADE_START,1.0,s); cap=pow(cap,TOP_FADE_EXP); env*=cap;
float ph=s/max(FLOW_PERIOD,EPS)+uFlowTime*uFlowSpeed;
float fl=pow(tri01(ph),FLOW_SHARPNESS);
env*=mix(1.0-uFlowStrength,1.0,fl);
float yp=(-R_V*uVLenFactor)*cos(tu),m=pow(smoothstep(FLARE_HEIGHT,0.0,yp),FLARE_EXP),wx=1.0+FLARE_AMOUNT*m;
vec2 sig=vec2(wx,1.0),p=vec2(0.0,yp);
float mask=step(0.0,yp);
b+=wt*bsa(uvc,p,mask*env,sig);
}
float sPix=clamp(yPix/R_V,0.0,1.0),topA=pow(1.0-smoothstep(TOP_FADE_START,1.0,sPix),TOP_FADE_EXP);
float L=a+b*topA;
float w=vWisps(vec2(uvc.x,yPix),topA);
float fog=0.0;
#if FOG_ON
vec2 fuv=uvc*uFogScale;
float mAct=step(1.0,length(iMouse.xy)),nx=((iMouse.x-C.x)*invW)*mAct;
float ax = abs(nx);
float stMag = mix(ax, pow(ax, FOG_TILT_SHAPE), 0.35);
float st = sign(nx) * stMag * uTiltScale;
st = clamp(st, -FOG_TILT_MAX_X, FOG_TILT_MAX_X);
vec2 dir=normalize(vec2(st,1.0));
fuv+=uFogTime*uFogFallSpeed*dir;
vec2 prp=vec2(-dir.y,dir.x);
fuv+=prp*(0.08*sin(dot(uvc,prp)*0.08+uFogTime*0.9));
float n=fbm2(fuv+vec2(fbm2(fuv+vec2(7.3,2.1)),fbm2(fuv+vec2(-3.7,5.9)))*0.6);
n=pow(clamp(n,0.0,1.0),FOG_CONTRAST);
float pixW = 1.0 / max(iResolution.y, 1.0);
#ifdef GL_OES_standard_derivatives
float wL = max(fwidth(L), pixW);
#else
float wL = pixW;
#endif
float m0=pow(smoothstep(FOG_BEAM_MIN - wL, FOG_BEAM_MAX + wL, L),FOG_MASK_GAMMA);
float bm=1.0-pow(1.0-m0,FOG_EXPAND_SHAPE); bm=mix(bm*m0,bm,FOG_EDGE_MIX);
float yP=1.0-smoothstep(HFOG_Y_RADIUS,HFOG_Y_RADIUS+HFOG_Y_SOFT,abs(yPix));
float nxF=abs((frag.x-C.x)*invW),hE=1.0-smoothstep(HFOG_EDGE_START,HFOG_EDGE_END,nxF); hE=pow(clamp(hE,0.0,1.0),HFOG_EDGE_GAMMA);
float hW=mix(1.0,hE,clamp(yP,0.0,1.0));
float bBias=mix(1.0,1.0-sPix,FOG_BOTTOM_BIAS);
float radialFade = 1.0 - smoothstep(0.0, 0.7, length(uvc) / 120.0);
fog = n * uFogIntensity * 1.8 * bBias * bm * hW * radialFade;
#endif
float LF=L+fog;
float dith=(h21(frag)-0.5)*(DITHER_STRENGTH/255.0);
float tone=g(LF+w);
vec3 col=tone*uColor+uCore*smoothstep(1.4,4.0,LF+w)+dith;
float nxE=abs((frag.x-C.x)*invW),xF=pow(clamp(1.0-smoothstep(EDGE_X0,EDGE_X1,nxE),0.0,1.0),EDGE_X_GAMMA);
float scene=LF+max(0.0,w)*0.5,hi=smoothstep(EDGE_LUMA_T0,EDGE_LUMA_T1,scene);
float eM=mix(xF,1.0,hi);
col*=eM;
col*=uFade;
fc=vec4(clamp(col,0.0,1.0),1.0);
}
void main(){
vec4 fc;
mainImage(fc, gl_FragCoord.xy);
gl_FragColor = fc;
}
`;
