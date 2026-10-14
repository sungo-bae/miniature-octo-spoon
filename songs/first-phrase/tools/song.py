"""Build song from the recorded motif: MIDI + ABC + WAV preview."""
import sys, os, numpy as np, mido, wave
OUT=sys.argv[1]; os.makedirs(OUT,exist_ok=True)
BPM=78; TPB=480; E=TPB//2  # eighth
N={'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':11}
def p(s):
    if s=='r': return None
    acc=1 if '#' in s else -1 if 'b' in s[1:] else 0
    return 12*(int(s[-1])+1)+N[s[0]]+acc
def bar(s):  # "C3:2 G3:6"  (lengths in eighths, must sum 8)
    r=[(p(x.split(':')[0]),int(x.split(':')[1])) for x in s.split()]
    assert sum(l for _,l in r)==8, s; return r
# --- sections: melody bars + chords (one or two per bar) ---
A=["C3:2 G3:6","D3:1 E3:1 G3:1 F3:5","G3:7 r:1","C3:4 r:4"]           # original motif
A2=["G3:1 F3:1 G3:1 F3:1 A3:1 F3:1 G3:2","G3:1 A3:1 E3:1 G3:3 r:2",
    "A3:1 B3:1 A3:1 F3:1 G3:1 F3:3","F3:1 G3:1 F3:1 G3:5"]
VERSE=dict(mel=A+A2, ch=["C","Dm7","Em7","F","C","Am7","Dm7","G7sus4 G7"])
PRE=dict(mel=["C4:1 F3:5 r:2","G3:5 r:1 E3:1 F3:1","G3:1 F3:1 C4:1 A3:1 Bb3:1 A3:3","F3:1 G3:1 F3:1 G3:1 C3:4"],
         ch=["F","Em7","Bbmaj7","G7sus4 G"])
CHO=dict(mel=["C4:2 E4:6","D4:1 C4:1 D4:1 E4:1 D4:4","C4:4 A3:2 G3:2","G3:1 A3:1 B3:1 C4:5",
              "C4:2 E4:6","D4:1 C4:1 D4:1 E4:1 F4:2 E4:2","D4:2 Bb3:2 A3:2 F3:2","G3:1 A3:1 B3:1 C4:5"],
         ch=["C","G/B","Am7","F G","C","Em7 A7","Bb","G C"])
BRI=dict(mel=["F3:2 F3:1 G3:1 F3:4","A3:2 G3:2 F3:2 E3:2","D3:1 E3:1 F3:1 G3:5","G3:6 r:2"],
         ch=["Am","F","Dm7","Gsus4 G"])
INTRO=dict(mel=["r:8"]*4, ch=["C","Bb","F","C"])
OUTRO=dict(mel=["C3:2 G3:6","D3:1 E3:1 G3:1 F3:5","G3:1 A3:1 B3:1 C4:5","C4:8"], ch=["C","Dm7","G C","C"])
FORM=[("Intro",INTRO),("Verse 1",VERSE),("Pre-Chorus",PRE),("Chorus",CHO),("Verse 2",VERSE),
      ("Pre-Chorus",PRE),("Chorus",CHO),("Bridge",BRI),("Chorus",CHO),("Outro",OUTRO)]
Q={'':[0,4,7],'m':[0,3,7],'7':[0,4,7,10],'m7':[0,3,7,10],'maj7':[0,4,7,11],'7sus4':[0,5,7,10],'sus4':[0,5,7]}
def chord(sym):
    s,bass=(sym.split('/')+[None])[:2]
    root=N[s[0]]+(-1 if s[1:2]=='b' else 0); q=s[2:] if s[1:2]=='b' else s[1:]
    tones=[48+root+i for i in Q[q]]
    b=(N[bass[0]] if bass else root)+36
    return tones,b
mel=[];chs=[];marks=[];bars=0
for name,sec in FORM:
    marks.append((bars,name))
    for mb,cb in zip(sec['mel'],sec['ch']):
        t=bars*8
        for pp,l in bar(mb):
            if pp: mel.append((t,l,pp))
            t+=l
        cs=cb.split(); w=8//len(cs)
        for i,c in enumerate(cs): chs.append((bars*8+i*w,w,c))
        bars+=1
# ---- MIDI ----
mf=mido.MidiFile(ticks_per_beat=TPB)
def track(name,prog,ch,events,meta=False):
    tr=mido.MidiTrack(); mf.tracks.append(tr); tr.append(mido.MetaMessage('track_name',name=name))
    if meta:
        tr.append(mido.MetaMessage('set_tempo',tempo=mido.bpm2tempo(BPM)))
        tr.append(mido.MetaMessage('key_signature',key='C'))
        tr.append(mido.MetaMessage('time_signature',numerator=4,denominator=4))
        for b,nm in marks: pass
    if ch!=9: tr.append(mido.Message('program_change',program=prog,channel=ch))
    ev=[]
    for s,l,n,v in events: ev+= [(s*E,1,n,v),((s+l)*E-10,0,n,0)]
    ev.sort(key=lambda x:(x[0],x[1])); now=0
    for tk,on,n,v in ev:
        tr.append(mido.Message('note_on' if on else 'note_off',note=n,velocity=v,channel=ch,time=tk-now)); now=tk
track("Melody (vocal guide)",73,0,[(s,l,n,96) for s,l,n in mel],meta=True)
pian=[];bass=[];drum=[]
for s,l,c in chs:
    t,b=chord(c)
    for n in t: pian.append((s,l,n,62))
    bass.append((s,l,b,84))
for b in range(bars):
    if b<4 or b>=bars-1: continue
    s=b*8; drum+= [(s,1,36,90),(s+4,1,38,70),(s+5,1,36,60)]+[(s+i,1,42,45) for i in range(8)]
track("Piano",0,1,pian); track("Bass",33,2,bass); track("Drums",0,9,drum)
mf.save(f"{OUT}/song.mid")
# motif only
m2=mido.MidiFile(ticks_per_beat=TPB); tr=mido.MidiTrack(); m2.tracks.append(tr)
tr.append(mido.MetaMessage('set_tempo',tempo=mido.bpm2tempo(BPM))); now=0
for s,l,n in [x for x in mel if 4*8<=x[0]<8*8]:
    s-=32; tr.append(mido.Message('note_on',note=n,velocity=96,time=s*E-now)); tr.append(mido.Message('note_off',note=n,time=l*E-10)); now=(s+l)*E-10
m2.save(f"{OUT}/motif_original.mid")
# ---- ABC (written an octave up, treble-8 clef) ----
def abcn(n):
    n+=12; names=['C','^C','D','_E','E','F','^F','G','_A','A','_B','B']
    o=n//12-1; nm=names[n%12]; base=nm[-1]; acc=nm[:-1]
    if o>=5: return acc+base.lower()+"'"*(o-5)
    return acc+base+","*(4-o)
def abclen(l): return {1:'',2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8'}[l]
lines=[];cur=[];bi=0
for name,sec in FORM:
    seg=[f'"^{name}"']
    for k,(mb,cb) in enumerate(zip(sec['mel'],sec['ch'])):
        cs=cb.split(); w=8//len(cs); t=0; ci=0; out=[]
        for pp,l in bar(mb):
            # split notes at chord change for simplicity: annotate chord at start positions
            parts=[]; rem=l; tt=t
            while rem>0:
                nxt=min(rem, (tt//w+1)*w-tt); parts.append((tt,nxt)); tt+=nxt; rem-=nxt
            for j,(ts,ln) in enumerate(parts):
                tok=''
                if ts%w==0 and ts//w<len(cs): tok+=f'"{cs[ts//w]}"'
                tok+=('z' if pp is None else abcn(pp))+abclen(ln)
                if pp is not None and j<len(parts)-1: tok+='-'
                out.append(tok)
            t+=l
        seg.append(' '.join(out)+' |'); 
        if (k+1)%4==0: seg.append('\n')
    lines.append(' '.join(seg))
abc="X:1\nT:첫 구절에서 (From the First Phrase)\nC:sketch from recording 2026-10-14\nM:4/4\nL:1/8\nQ:1/4=78\nK:C clef=treble-8\n"+''.join(lines).replace('\n ','\n').rstrip(' \n|')+' |]\n'
open(f"{OUT}/song.abc","w").write(abc)
# ---- WAV preview synth ----
SR=32000; spe=60/BPM/2; total=int((bars*8*spe+3)*SR); mix=np.zeros(total)
def hz(n): return 440*2**((n-69)/12)
def add(s,l,sig): 
    a=int(s*spe*SR); mix[a:a+len(sig)]+=sig[:max(0,total-a)]
for s,l,n in mel:
    d=l*spe; t=np.arange(int(d*SR))/SR; f=hz(n)*(1+0.004*np.sin(2*np.pi*5.5*t)*np.clip(t-0.25,0,1))
    ph=2*np.pi*np.cumsum(f)/SR
    sig=np.sin(ph)+0.35*np.sin(2*ph)+0.15*np.sin(3*ph)
    env=np.minimum(1,t/0.04)*np.minimum(1,(d-t)/0.08)
    add(s,l,0.22*sig*env)
for s,l,n,v in pian:
    d=l*spe+0.3; t=np.arange(int(d*SR))/SR; f=hz(n+12)
    sig=(np.sin(2*np.pi*f*t)+0.3*np.sin(4*np.pi*f*t))*np.exp(-t*1.6)*np.minimum(1,(d-t)/0.2)*np.minimum(1,t/0.005)
    add(s,l,0.07*sig)
for s,l,n,v in bass:
    d=l*spe; t=np.arange(int(d*SR))/SR; f=hz(n)
    sig=(np.sin(2*np.pi*f*t)+0.2*np.sin(4*np.pi*f*t))*np.exp(-t*0.8)*np.minimum(1,(d-t)/0.05)*np.minimum(1,t/0.01)
    add(s,l,0.25*sig)
rng=np.random.default_rng(1)
for s,l,n,v in drum:
    t=np.arange(int(0.3*SR))/SR
    if n==36: sig=np.sin(2*np.pi*(50+90*np.exp(-t*30))*t)*np.exp(-t*12)*0.35*v/90
    elif n==38: sig=rng.normal(0,1,len(t))*np.exp(-t*18)*0.08
    else: sig=np.diff(rng.normal(0,1,len(t)+1))*np.exp(-t*60)*0.02
    add(s,1,sig)
mix/=np.abs(mix).max()*1.1
w=wave.open(f"{OUT}/preview.wav","wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
w.writeframes((mix*32767).astype(np.int16).tobytes()); w.close()
print("bars",bars,"seconds",bars*8*spe)
print(abc)
