import sys, json
import types; sys_mod = __import__("sys"); sys_mod.modules["cv2"] = types.ModuleType("cv2")  # path/timing maths never call cv2
"""Regenerates python_ref.json from the original Python tracer (comet_marks.py / tracer2.py).
usage: python make_python_ref.py <dir with comet_marks.py> <out.json>"""
D, OUT = sys.argv[1], sys.argv[2]
sys.argv = [sys.argv[0], D]; sys.path.insert(0, D)
import comet_marks as cm
from tracer2 import flight
cases = [
  dict(name="auto_right", S=(600,900), A=(1000,250), E=(1300,520), shape="auto"),
  dict(name="auto_left_bends", S=(1200,950), A=(800,300), E=(500,560), shape="auto", M=(1100,600), N=(600,380)),
  dict(name="fade", S=(900,950), A=(980,300), E=(1150,560), shape="fade"),
  dict(name="draw", S=(900,950), A=(860,300), E=(700,560), shape="draw"),
  dict(name="straight", S=(960,1000), A=(960,280), E=(965,540), shape="straight"),
  dict(name="draw_marks_disagree", S=(900,950), A=(1100,300), E=(1150,560), shape="draw", M=(950,700)),
]
out = []
for c in cases:
    M, N = c.get("M"), c.get("N")
    rise, fall = cm.path_pts(c["S"], c["A"], c["E"], n=60, shape=c["shape"], M=M, N=N)
    S, A, E = c["S"], c["A"], c["E"]
    hz = min(S[1]-40, max(A[1]+20, E[1]+5))
    smp = cm.timed(S, A, E, 5.5, 160, 28, hz, shape=c["shape"], M=M, N=N)
    pick = [0, 50, 200, 400, 600, 800, 1000, 1200, len(smp)-1]
    out.append(dict(c, rise=[list(map(float,p)) for p in rise], fall=[list(map(float,p)) for p in fall], hz=hz,
        timed=[[float(v) for v in smp[i]] for i in pick], nsmp=len(smp)))
phys, d0 = flight((700, 900), 400, 800, T=6.5, carry=265, apex=32)
rs, Tr = cm.ricochet((1300,520), (1420,540), 5.5, 160.0)
json.dump(dict(cases=out, flight=dict(S=[700,900], yh=400, vx=800, T=6.5, carry=265, apex=32, d0=d0, n=len(phys), pick=[[float(v) for v in phys[i]] for i in (0, 100, 500, 900, 1300, len(phys)-1)], pickIdx=[0,100,500,900,1300,len(phys)-1]),
    rico=dict(E=[1300,520], R=[1420,540], t0=5.5, X0=160, Tr=Tr, pts=[[float(v) for v in rs[i]] for i in (0, 30, 60, 119)])), open(OUT, "w"), indent=0)
print("ok")
