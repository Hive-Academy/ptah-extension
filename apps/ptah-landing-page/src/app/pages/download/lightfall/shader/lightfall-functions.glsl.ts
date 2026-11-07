/** Tone curve, falloffs, hash and fbm noise, and the wisp streaks. Part of LIGHTFALL_FRAGMENT (see lightfall-shader.ts). */
export const LIGHTFALL_FUNCTIONS = `
float g(float x){return x<=0.00031308?12.92*x:1.055*pow(x,1.0/2.4)-0.055;}
float bs(vec2 p,vec2 q,float powr){
float d=distance(p,q),f=powr*uFalloffStart,r=(f*f)/(d*d+EPS);
return powr*min(1.0,r);
}
float bsa(vec2 p,vec2 q,float powr,vec2 s){
vec2 d=p-q; float dd=(d.x*d.x)/(s.x*s.x)+(d.y*d.y)/(s.y*s.y),f=powr*uFalloffStart,r=(f*f)/(dd+EPS);
return powr*min(1.0,r);
}
float tri01(float x){float f=fract(x);return 1.0-abs(f*2.0-1.0);}
float tauWf(float t,float tmin,float tmax){float a=smoothstep(tmin,tmin+EDGE_SOFT,t),b=1.0-smoothstep(tmax-EDGE_SOFT,tmax,t);return max(0.0,a*b);} 
float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+34.123);return fract(p.x*p.y);}
float vnoise(vec2 p){
vec2 i=floor(p),f=fract(p);
float a=h21(i),b=h21(i+vec2(1,0)),c=h21(i+vec2(0,1)),d=h21(i+vec2(1,1));
vec2 u=f*f*(3.0-2.0*f);
return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
}
float fbm2(vec2 p){
float v=0.0,amp=0.6; mat2 m=mat2(0.86,0.5,-0.5,0.86);
for(int i=0;i<FOG_OCTAVES;++i){v+=amp*vnoise(p); p=m*p*2.03+17.1; amp*=0.52;}
return v;
}
float rGate(float x,float l){float a=smoothstep(0.0,W_AA,x),b=1.0-smoothstep(l,l+W_AA,x);return max(0.0,a*b);}
float flareY(float y){float t=clamp(1.0-(clamp(y,0.0,FLARE_HEIGHT)/max(FLARE_HEIGHT,EPS)),0.0,1.0);return pow(t,FLARE_EXP);}
float vWisps(vec2 uv,float topF){
float y=uv.y,yf=(y+uFlowTime*uWSpeed)/W_CELL;
float dRaw=clamp(uWispDensity,0.0,2.0),d=dRaw<=0.0?1.0:dRaw;
float lanesF=floor(float(W_LANES)*min(d,1.0)+0.5); // WebGL1-safe
int lanes=int(max(1.0,lanesF));
float sp=min(d,1.0),ep=max(d-1.0,0.0);
float fm=flareY(max(y,0.0)),rm=clamp(1.0-(y/max(W_CURVE_RANGE,EPS)),0.0,1.0),cm=fm*rm;
const float G=0.05; float xS=1.0+(FLARE_AMOUNT*W_CURVE_AMOUNT*G)*cm;
float sPix=clamp(y/R_V,0.0,1.0),bGain=pow(1.0-sPix,W_BOTTOM_EXP),sum=0.0;
for(int s=0;s<2;++s){
float sgn=s==0?-1.0:1.0;
for(int i=0;i<W_LANES;++i){
if(i>=lanes) break;
float off=W_BASE_X+float(i)*W_LAYER_GAP,xc=sgn*(off*xS);
float dx=abs(uv.x-xc),lat=1.0-smoothstep(W_HALF,W_HALF+W_AA,dx),amp=exp(-off*W_SIDE_DECAY);
float seed=h21(vec2(off,sgn*17.0)),yf2=yf+seed*7.0,ci=floor(yf2),fy=fract(yf2);
float seg=mix(W_SEG_MIN,W_SEG_MAX,h21(vec2(ci,off*2.3)));
float spR=h21(vec2(ci,off+sgn*31.0)),seg1=rGate(fy,seg)*step(spR,sp);
if(ep>0.0){float spR2=h21(vec2(ci*3.1+7.0,off*5.3+sgn*13.0)); float f2=fract(fy+0.5); seg1+=rGate(f2,seg*0.9)*step(spR2,ep);}
sum+=amp*lat*seg1;
}
}
float span=smoothstep(-3.0,0.0,y)*(1.0-smoothstep(R_V-6.0,R_V,y));
return uWIntensity*sum*topF*bGain*span;
}
`;
