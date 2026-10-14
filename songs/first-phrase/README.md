# 첫 구절 스케치

2026-10-14에 녹음한 1분짜리 구절을 분석해서 만든 곡의 뼈대입니다. 원본 녹음 파일은 저장소에 넣지 않았습니다.

- 분석 결과: C장조, 약 78 BPM, 음역 E3–C4, 중심음 G
- 구성: Intro 4 / Verse 8 / Pre 4 / Chorus 8 / Verse 8 / Pre 4 / Chorus 8 / Bridge 4 / Chorus 8 / Outro 4 (총 60마디, 4/4)

| 파일 | 내용 |
|---|---|
| `song.mid` | 전체 곡 MIDI (멜로디, 피아노, 베이스, 드럼 트랙) |
| `motif_original.mid` | 녹음에서 뽑아 정리한 원래 구절 4마디 |
| `song.abc` | 코드가 붙은 리드시트(ABC 형식, MuseScore나 abcjs로 열 수 있음) |
| `preview.mp3` | 합성한 가이드 음원 |
| `tools/` | 분석(`analyze.py`, `quant.py`)과 생성(`song.py`)에 쓴 스크립트 |

다시 만들기: `python3 tools/song.py <출력폴더>` (librosa, mido, numpy 필요)
