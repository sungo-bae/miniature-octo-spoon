import sys, numpy as np, librosa
y, sr = librosa.load(sys.argv[1], sr=22050, mono=True)
print("duration", len(y)/sr)
rms = librosa.feature.rms(y=y)[0]
print("rms max/median", rms.max(), np.median(rms))
f0, vf, vp = librosa.pyin(y, fmin=65, fmax=1000, sr=sr, frame_length=2048, hop_length=256)
t = librosa.times_like(f0, sr=sr, hop_length=256)
print("voiced ratio", np.mean(vf))
tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
print("tempo", tempo)
midi = librosa.hz_to_midi(f0)
# segment into notes
notes=[]; cur=None
for i,(m,v) in enumerate(zip(midi,vf)):
    if v and not np.isnan(m):
        r=m
        if cur and abs(r-np.median(cur['p']))<0.7 and i-cur['end']<=3:
            cur['p'].append(r); cur['end']=i
        else:
            if cur: notes.append(cur)
            cur={'start':i,'end':i,'p':[r]}
if cur: notes.append(cur)
notes=[n for n in notes if (n['end']-n['start']+1)*256/sr>=0.08]
for n in notes:
    p=np.median(n['p'])
    print(f"{t[n['start']]:6.2f}-{t[n['end']]:6.2f}  {librosa.midi_to_note(round(p)):4s} ({p:.2f})")
chroma = librosa.feature.chroma_cqt(y=y, sr=sr).mean(axis=1)
print("chroma", np.round(chroma/chroma.max(),2))
np.save(sys.argv[2], np.array([[t[n['start']],t[n['end']]+256/sr,np.median(n['p'])] for n in notes]))
