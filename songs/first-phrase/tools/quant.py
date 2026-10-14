import sys, numpy as np, librosa
y, sr = librosa.load(sys.argv[1], sr=22050)
hop=256
f0,vf,_=librosa.pyin(y,fmin=90,fmax=700,sr=sr,frame_length=2048,hop_length=hop)
m=librosa.hz_to_midi(f0); t=librosa.times_like(f0,sr=sr,hop_length=hop)
# octave-fix: G2/F#2 dips -> up an octave (voice break), keep C3
for i in range(len(m)):
    if vf[i] and not np.isnan(m[i]) and m[i]<46.5 and abs(m[i]-48)>1.5: m[i]+=12
scale=[0,2,4,5,7,9,11,10]
def snap(p):
    c=[o*12+s for o in range(2,6) for s in scale]
    return min(c,key=lambda x:abs(x-p))
# median filter
from scipy.signal import medfilt
mm=np.where(vf&~np.isnan(m),m,0); mm=medfilt(mm,9)
q=[snap(x) if x>0 else 0 for x in mm]
segs=[];s=0
for i in range(1,len(q)+1):
    if i==len(q) or q[i]!=q[s]:
        segs.append([t[s],t[i-1]+hop/sr,q[s]]); s=i
segs=[x for x in segs if x[2]>0 and x[1]-x[0]>=0.15]
# merge same pitch with small gap
out=[]
for a in segs:
    if out and out[-1][2]==a[2] and a[0]-out[-1][1]<0.25: out[-1][1]=a[1]
    else: out.append(a)
bpm=float(sys.argv[2]); e=60/bpm/2
t0=out[0][0]
for a,b,p in out:
    print(f"{a:6.2f} {librosa.midi_to_note(p,unicode=False):4s} start8={round((a-t0)/e):3d} len8={max(1,round((b-a)/e))}")
np.save(sys.argv[3],np.array(out))
