// llgen -- the solutions of a last-layer / last-slot case in a move set
// (README "Algorithm sets"; driven by tools/ll-gen.js).
//
// The search is in the solver's own view of the cube ("human view"): pieces
// are identified by the solved colour scheme and positions are fixed in
// space, so every token (R, U, F, D, L, B, wide r u f d l b, slices M E S)
// is one fixed permutation, and wide and slice turns also move the centres
// (tracked as a frame: the whole-cube rotation the centres are in). A
// solution is a token sequence that leaves the pieces solved, as the set's
// goal asks, relative to the centres, with U still on top.
//
// Token cubies, the frames' cubies and the frame transitions come from stdin
// (tools/ll-gen.js reads them off facelet-cube.js); nothing is typed here.
// The human view of a goal state N (centre-relative) in frame f is
// rot_f * N (rot_f first, verified in test/alg-sets.test.js).
//
// Goals (all invariant under a U turn: the caller passes the four pre-AUF
// starts, and a solution never starts or ends with a U turn):
//   0 LL    F2L solved, last layer solved up to AUF   (PLL, ZBLL)
//   1 OLL   F2L solved, last layer oriented            (OLL, OLS)
//   2 COLL  F2L solved, LL corners solved up to AUF, LL edges oriented
//   3 ZBLS  F2L solved, LL edges oriented
//
// Pruning: max of three exact pattern databases built in the move set
// itself (BFS from every goal state's projection, in every final frame the
// set can reach): the 8 corners (88M), the 6 edges UR UF UL UB FR FL and
// the 6 others (42.6M each); nibbles, 15 = unreachable; cached on disk per
// move set and goal. The search reads the active move set's move tables
// side by side and checks the three tables one at a time, most children
// being cut by the first (both changes kept the output identical).
//
// stdin:  TOKEN <i> <name> <axis> <pureU> <cubie>     (axis 0 R/L, 1 U/D, 2 F/B)
//         FRAME <f> <yfamily> <cubie>                 (f = 0: identity)
//         NF <f> <t> <frame after t in f>
//         TABLES <dir>
//         CASE <id> <goal> <maxLen> <slack> <maxSols> <nodeLimit> <setName> <nTok> <tok...> <nStarts> <cubie...>
//         (cubie = cp*8 co*8 ep*12 eo*12)
// stdout: CASE <id> <optimal or -1> <bound> <count> <truncated> <nodes>
//         S <length> <start> <tokens ...>
//         END <id>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <string>
#include <vector>
#include <array>
#include <map>
#include <unordered_set>
#include <iostream>
#include <algorithm>
#include <sys/stat.h>
#include <unistd.h>

using namespace std;

struct Cubie { int cp[8], co[8], ep[12], eo[12]; };
static Cubie mul(const Cubie &a, const Cubie &b) { // a, then b
  Cubie c;
  for (int i = 0; i < 8; i++) { c.cp[i] = a.cp[b.cp[i]]; c.co[i] = (a.co[b.cp[i]] + b.co[i]) % 3; }
  for (int i = 0; i < 12; i++) { c.ep[i] = a.ep[b.ep[i]]; c.eo[i] = (a.eo[b.ep[i]] + b.eo[i]) % 2; }
  return c;
}
static Cubie identity() {
  Cubie c;
  for (int i = 0; i < 8; i++) { c.cp[i] = i; c.co[i] = 0; }
  for (int i = 0; i < 12; i++) { c.ep[i] = i; c.eo[i] = 0; }
  return c;
}
static Cubie readCubie(istream &in) {
  Cubie c;
  for (int i = 0; i < 8; i++) in >> c.cp[i];
  for (int i = 0; i < 8; i++) in >> c.co[i];
  for (int i = 0; i < 12; i++) in >> c.ep[i];
  for (int i = 0; i < 12; i++) in >> c.eo[i];
  return c;
}

// ---- coordinates ---------------------------------------------------------
static const int NCP = 40320, NTW = 2187, NPL = 665280;
static const size_t NC = (size_t)NCP * NTW, NE6 = (size_t)NPL * 64;
static int cpRank(const int *p) {
  int r = 0;
  for (int i = 0; i < 8; i++) { int s = 0; for (int j = i + 1; j < 8; j++) if (p[j] < p[i]) s++; r = r * (8 - i) + s; }
  return r;
}
static void cpUnrank(int r, int *p) {
  int code[8];
  for (int i = 7; i >= 0; i--) { code[i] = r % (8 - i); r /= (8 - i); }
  bool used[8] = {};
  for (int i = 0; i < 8; i++) { int s = code[i]; for (int v = 0; v < 8; v++) if (!used[v]) { if (s == 0) { p[i] = v; used[v] = true; break; } s--; } }
}
static int twRank(const int *o) { int r = 0; for (int i = 0; i < 7; i++) r = r * 3 + o[i]; return r; }
static void twUnrank(int r, int *o) { int s = 0; for (int i = 6; i >= 0; i--) { o[i] = r % 3; r /= 3; s += o[i]; } o[7] = (3 - s % 3) % 3; }
static int plRank(const int *pos) {
  int r = 0; bool used[12] = {};
  for (int i = 0; i < 6; i++) { int s = 0; for (int v = 0; v < pos[i]; v++) if (!used[v]) s++; used[pos[i]] = true; r = r * (12 - i) + s; }
  return r;
}
static void plUnrank(int r, int *pos) {
  int code[6];
  for (int i = 5; i >= 0; i--) { code[i] = r % (12 - i); r /= (12 - i); }
  bool used[12] = {};
  for (int i = 0; i < 6; i++) { int s = code[i]; for (int v = 0; v < 12; v++) if (!used[v]) { if (s == 0) { pos[i] = v; used[v] = true; break; } s--; } }
}
static const int TRACK[2][6] = { { 0, 1, 2, 3, 8, 9 }, { 4, 5, 6, 7, 10, 11 } };

// ---- tokens and frames ------------------------------------------------------
static const int MAXT = 64, MAXF = 24;
static int NTOK = 0, TOK_U = -1;
static string TOKNAME[MAXT];
static int TOKAXIS[MAXT], TOKPUREU[MAXT];
static Cubie TOKC[MAXT];
static bool TOKCORNERS[MAXT], TOKEDGES[MAXT];   // does it move any corner / edge?
static Cubie ROT[MAXF];
static bool YFAM[MAXF];
static int NF[MAXF][MAXT];

static vector<uint16_t> cpMove, twMove;   // [coord * MAXT + t]
static vector<int32_t> plMove;
static vector<uint8_t> plFlip;

static void buildMoveTables() {
  cpMove.assign((size_t)NCP * MAXT, 0); twMove.assign((size_t)NTW * MAXT, 0);
  for (int r = 0; r < NCP; r++) {
    Cubie a = identity(); cpUnrank(r, a.cp);
    for (int t = 0; t < NTOK; t++) { Cubie b = mul(a, TOKC[t]); cpMove[(size_t)r * MAXT + t] = cpRank(b.cp); }
  }
  for (int r = 0; r < NTW; r++) {
    Cubie a = identity(); twUnrank(r, a.co);
    for (int t = 0; t < NTOK; t++) { Cubie b = mul(a, TOKC[t]); twMove[(size_t)r * MAXT + t] = twRank(b.co); }
  }
  static int dest[MAXT][12], flip[MAXT][12];
  for (int t = 0; t < NTOK; t++) for (int q = 0; q < 12; q++) { dest[t][TOKC[t].ep[q]] = q; flip[t][TOKC[t].ep[q]] = TOKC[t].eo[q]; }
  plMove.assign((size_t)NPL * MAXT, 0); plFlip.assign((size_t)NPL * MAXT, 0);
  for (int r = 0; r < NPL; r++) {
    int pos[6]; plUnrank(r, pos);
    for (int t = 0; t < NTOK; t++) {
      int np[6], mask = 0;
      for (int i = 0; i < 6; i++) { np[i] = dest[t][pos[i]]; if (flip[t][pos[i]]) mask |= 1 << i; }
      plMove[(size_t)r * MAXT + t] = plRank(np); plFlip[(size_t)r * MAXT + t] = mask;
    }
  }
  for (int t = 0; t < NTOK; t++) {
    Cubie &c = TOKC[t];
    TOKCORNERS[t] = TOKEDGES[t] = false;
    for (int i = 0; i < 8; i++) if (c.cp[i] != i || c.co[i]) TOKCORNERS[t] = true;
    for (int i = 0; i < 12; i++) if (c.ep[i] != i || c.eo[i]) TOKEDGES[t] = true;
  }
}

struct S { int cp, tw, pa, oa, pb, ob; };
static inline S applyTok(const S &s, int t) {
  S u;
  u.cp = cpMove[(size_t)s.cp * MAXT + t]; u.tw = twMove[(size_t)s.tw * MAXT + t];
  u.pa = plMove[(size_t)s.pa * MAXT + t]; u.oa = s.oa ^ plFlip[(size_t)s.pa * MAXT + t];
  u.pb = plMove[(size_t)s.pb * MAXT + t]; u.ob = s.ob ^ plFlip[(size_t)s.pb * MAXT + t];
  return u;
}

// The search's move tables for the active move set only, its K tokens side
// by side per coordinate (a node's children read one block each instead of
// K scattered entries); local token k is TOKS[k].
static int K = 0;
static vector<int> KTOK;
static vector<uint16_t> kCp, kTw;
static vector<int32_t> kPl;
static vector<uint8_t> kFlip;
static void compactTables(const vector<int> &toks) {
  if ((int)toks.size() == K && toks == KTOK) return;
  K = toks.size(); KTOK = toks;
  kCp.resize((size_t)NCP * K); kTw.resize((size_t)NTW * K);
  kPl.resize((size_t)NPL * K); kFlip.resize((size_t)NPL * K);
  for (int r = 0; r < NCP; r++) for (int k = 0; k < K; k++) kCp[(size_t)r * K + k] = cpMove[(size_t)r * MAXT + toks[k]];
  for (int r = 0; r < NTW; r++) for (int k = 0; k < K; k++) kTw[(size_t)r * K + k] = twMove[(size_t)r * MAXT + toks[k]];
  for (int r = 0; r < NPL; r++) for (int k = 0; k < K; k++) {
    kPl[(size_t)r * K + k] = plMove[(size_t)r * MAXT + toks[k]];
    kFlip[(size_t)r * K + k] = plFlip[(size_t)r * MAXT + toks[k]];
  }
}
static S fromCubie(const Cubie &c) {
  S s; s.cp = cpRank(c.cp); s.tw = twRank(c.co);
  for (int t = 0; t < 2; t++) {
    int pos[6], ori = 0;
    for (int i = 0; i < 6; i++) for (int p = 0; p < 12; p++) if (c.ep[p] == TRACK[t][i]) { pos[i] = p; if (c.eo[p]) ori |= 1 << i; }
    if (t == 0) { s.pa = plRank(pos); s.oa = ori; } else { s.pb = plRank(pos); s.ob = ori; }
  }
  return s;
}
static inline size_t cIdx(int cp, int tw) { return (size_t)cp * NTW + tw; }
static inline size_t eIdx(int pl, int o) { return (size_t)pl * 64 + o; }
// the whole state (corners, both edge halves, frame) as one key
static inline uint64_t fullKey(const S &s, int frame) {
  uint64_t a = (uint64_t)s.cp * NTW + s.tw;                       // < 2^27
  uint64_t b = ((uint64_t)s.pa * 64 + s.oa) * NPL + s.pb;          // < 2^46
  return (a * 0x9E3779B97F4A7C15ULL) ^ (b * 0xC2B2AE3D27D4EB4FULL) ^ ((uint64_t)s.ob << 5) ^ (uint64_t)frame;
}

// ---- nibble tables -----------------------------------------------------------
struct Nib {
  vector<uint8_t> d; size_t n = 0;
  void init(size_t N) { n = N; d.assign((N + 1) / 2, 0xFF); }
  inline int get(size_t i) const { return (d[i >> 1] >> ((i & 1) << 2)) & 15; }
  inline void set(size_t i, int v) { uint8_t &b = d[i >> 1]; int sh = (i & 1) << 2; b = (uint8_t)((b & ~(15 << sh)) | (v << sh)); }
};
static bool loadTable(const string &file, Nib &t, size_t N) {
  FILE *f = fopen(file.c_str(), "rb"); if (!f) return false;
  t.n = N; t.d.resize((N + 1) / 2);
  size_t r = fread(t.d.data(), 1, t.d.size(), f); fclose(f);
  return r == t.d.size();
}
static void saveTable(const string &file, const Nib &t) {
  // a temporary file per process: parallel runs may build the same table
  string tmp = file + ".tmp" + std::to_string(getpid());
  FILE *f = fopen(tmp.c_str(), "wb"); if (!f) return;
  fwrite(t.d.data(), 1, t.d.size(), f); fclose(f);
  rename(tmp.c_str(), file.c_str());
}

// Breadth-first from the sources with the move set's tokens; 15 marks a
// state the set cannot reach, and when the depth cap stops the search, the
// states not reached get the cap (a lower bound).
template <class Step>
static void bfs(Nib &t, size_t N, const vector<size_t> &src, Step step, const char *what) {
  t.init(N);
  for (auto s : src) t.set(s, 0);
  size_t filled = src.size();
  int depth = 0;
  bool capped = false;
  for (;; depth++) {
    size_t before = filled;
    for (size_t i = 0; i < N; i++) {
      if (t.get(i) != depth) continue;
      step(i, [&](size_t j) { if (t.get(j) == 15) { t.set(j, depth + 1); filled++; } });
    }
    if (filled == before) break;
    if (depth + 1 >= 14) { capped = true; break; }
  }
  if (capped) for (size_t i = 0; i < N; i++) if (t.get(i) == 15) t.set(i, 14);
  fprintf(stderr, "  %s: depth %d%s, %zu reached\n", what, depth + 1, capped ? " (capped)" : "", filled);
}

// ---- goals --------------------------------------------------------------------
// every centre-relative state a goal allows (F2L solved)
static vector<Cubie> goalStates(int goal) {
  vector<Cubie> out;
  Cubie U = TOKC[TOK_U];
  if (goal == 0) { Cubie c = identity(); for (int k = 0; k < 4; k++) { out.push_back(c); c = mul(c, U); } return out; }
  int perm[4] = { 0, 1, 2, 3 };
  vector<array<int, 4>> perms;
  do { perms.push_back({ perm[0], perm[1], perm[2], perm[3] }); } while (next_permutation(perm, perm + 4));
  if (goal == 1) {
    for (auto &pc : perms) for (auto &pe : perms) {
      Cubie c = identity();
      for (int i = 0; i < 4; i++) { c.cp[i] = pc[i]; c.ep[i] = pe[i]; }
      out.push_back(c);
    }
  } else if (goal == 2) {
    Cubie u = identity();
    for (int k = 0; k < 4; k++) {
      for (auto &pe : perms) { Cubie c = u; for (int i = 0; i < 4; i++) c.ep[i] = pe[i]; out.push_back(c); }
      u = mul(u, U);
    }
  } else {
    for (auto &pc : perms) for (int tw = 0; tw < 27; tw++) for (auto &pe : perms) {
      Cubie c = identity();
      int t = tw, s = 0;
      for (int i = 0; i < 3; i++) { c.co[i] = t % 3; s += t % 3; t /= 3; }
      c.co[3] = (3 - s % 3) % 3;
      for (int i = 0; i < 4; i++) { c.cp[i] = pc[i]; c.ep[i] = pe[i]; }
      out.push_back(c);
    }
  }
  return out;
}

struct Tables {
  Nib corner, edgeA, edgeB;
  unordered_set<uint64_t> exact; // fullKey of every goal state in an allowed frame
};
static map<string, Tables *> CACHE;
static string tableDir = ".";

static vector<int> finalFrames(const vector<int> &toks) {
  bool seen[MAXF] = {}; vector<int> q = { 0 }; seen[0] = true;
  for (size_t i = 0; i < q.size(); i++) for (int t : toks) { int g = NF[q[i]][t]; if (!seen[g]) { seen[g] = true; q.push_back(g); } }
  vector<int> out;
  for (int f : q) if (YFAM[f]) out.push_back(f);
  return out;
}

static Tables *tablesFor(const string &setName, int goal, const vector<int> &toks) {
  string key = setName + "_g" + to_string(goal);
  auto it = CACHE.find(key);
  if (it != CACHE.end()) return it->second;
  for (auto &kv : CACHE) delete kv.second; // one set of tables in memory at a time
  CACHE.clear();
  Tables *T = new Tables();
  vector<int> frames = finalFrames(toks);
  vector<size_t> cs, ea, eb;
  for (int f : frames) for (auto &n : goalStates(goal)) {
    S s = fromCubie(mul(ROT[f], n));
    cs.push_back(cIdx(s.cp, s.tw)); ea.push_back(eIdx(s.pa, s.oa)); eb.push_back(eIdx(s.pb, s.ob));
    T->exact.insert(fullKey(s, f));
  }
  auto uniq = [](vector<size_t> &v) { sort(v.begin(), v.end()); v.erase(unique(v.begin(), v.end()), v.end()); };
  uniq(cs); uniq(ea); uniq(eb);
  vector<int> ct, et;
  for (int t : toks) { if (TOKCORNERS[t]) ct.push_back(t); if (TOKEDGES[t]) et.push_back(t); }
  string base = tableDir + "/" + key;
  string bset = tableDir + "/" + setName + "_B";
  if (!loadTable(base + "_C.bin", T->corner, NC)) {
    fprintf(stderr, "building %s corners\n", key.c_str());
    bfs(T->corner, NC, cs, [&](size_t i, auto push) {
      int cp = i / NTW, tw = i % NTW;
      for (int t : ct) push(cIdx(cpMove[(size_t)cp * MAXT + t], twMove[(size_t)tw * MAXT + t]));
    }, "corners");
    saveTable(base + "_C.bin", T->corner);
  }
  auto edgeStep = [&](size_t i, auto push) {
    int pl = i >> 6, o = i & 63;
    for (int t : et) push(eIdx(plMove[(size_t)pl * MAXT + t], o ^ plFlip[(size_t)pl * MAXT + t]));
  };
  if (!loadTable(base + "_A.bin", T->edgeA, NE6)) {
    fprintf(stderr, "building %s edges A\n", key.c_str());
    bfs(T->edgeA, NE6, ea, edgeStep, "edges A");
    saveTable(base + "_A.bin", T->edgeA);
  }
  if (!loadTable(bset + ".bin", T->edgeB, NE6)) {
    fprintf(stderr, "building %s edges B\n", setName.c_str());
    bfs(T->edgeB, NE6, eb, edgeStep, "edges B");
    saveTable(bset + ".bin", T->edgeB);
  }
  CACHE[key] = T;
  return T;
}

// ---- search ------------------------------------------------------------------
static Tables *cur;
static inline int h(const S &s) {
  int a = cur->corner.get(cIdx(s.cp, s.tw));
  int b = cur->edgeA.get(eIdx(s.pa, s.oa));
  int c = cur->edgeB.get(eIdx(s.pb, s.ob));
  int m = max(a, max(b, c));
  return m == 15 ? 99 : m;
}

static int path[64], pathLen, startIdx;
static vector<int> toks;
static long long found, maxSols, nodes, nodeLimit;
static bool truncated;
static string outBuf;

static void emit(int len) {
  outBuf += "S " + to_string(len) + " " + to_string(startIdx);
  for (int i = 0; i < pathLen; i++) { outBuf += ' '; outBuf += TOKNAME[path[i]]; }
  outBuf += '\n';
}

// collect every solution of length <= bound (all), or stop at the first
static bool dfs(const S &s, int frame, int g, int bound, int lastAxis, bool all) {
  if (++nodes > nodeLimit) { truncated = true; return false; }
  const uint16_t *cpRow = &kCp[(size_t)s.cp * K], *twRow = &kTw[(size_t)s.tw * K];
  const int32_t *paRow = &kPl[(size_t)s.pa * K], *pbRow = &kPl[(size_t)s.pb * K];
  const uint8_t *faRow = &kFlip[(size_t)s.pa * K], *fbRow = &kFlip[(size_t)s.pb * K];
  for (int k = 0; k < K; k++) {
    const int t = KTOK[k];
    if (TOKAXIS[t] == lastAxis) continue;
    if (g == 0 && TOKPUREU[t]) continue;           // the pre-AUF is the start's
    S u;
    u.cp = cpRow[k]; u.tw = twRow[k];
    u.pa = paRow[k]; u.oa = s.oa ^ faRow[k];
    u.pb = pbRow[k]; u.ob = s.ob ^ fbRow[k];
    // the three tables one at a time: most children are cut by the first
    // (15 = unreachable in this move set)
    const int ng = g + 1, room = bound - ng;
    const int hc = cur->corner.get(cIdx(u.cp, u.tw));
    if (hc > room || hc == 15) continue;
    const int ha = cur->edgeA.get(eIdx(u.pa, u.oa));
    if (ha > room || ha == 15) continue;
    const int hb = cur->edgeB.get(eIdx(u.pb, u.ob));
    if (hb > room || hb == 15) continue;
    const int hu = max(hc, max(ha, hb));
    int nf = NF[frame][t];
    path[pathLen++] = t;
    if (hu == 0 && !TOKPUREU[t] && cur->exact.count(fullKey(u, nf))) { // never end on an AUF
      if (!all) { pathLen--; return true; }
      emit(ng);
      if (++found >= maxSols) truncated = true;
    } else if (ng < bound) {
      if (dfs(u, nf, ng, bound, TOKAXIS[t], all)) { pathLen--; return true; }
    }
    pathLen--;
    if (truncated) return false;
  }
  return false;
}

int main() {
  ios::sync_with_stdio(false);
  string tok;
  bool moveTables = false;
  while (cin >> tok) {
    if (tok == "TOKEN") {
      int i; string name; cin >> i >> name >> TOKAXIS[i] >> TOKPUREU[i];
      TOKC[i] = readCubie(cin); TOKNAME[i] = name; NTOK = max(NTOK, i + 1);
      if (name == "U") TOK_U = i;
    } else if (tok == "FRAME") {
      int f, y; cin >> f >> y; YFAM[f] = y; ROT[f] = readCubie(cin);
    } else if (tok == "NF") {
      int f, t; cin >> f >> t; cin >> NF[f][t];
    } else if (tok == "TABLES") {
      cin >> tableDir; mkdir(tableDir.c_str(), 0755);
    } else if (tok == "CASE") {
      if (!moveTables) { buildMoveTables(); moveTables = true; }
      string id, setName; int goal, maxLen, slack, nt, n;
      cin >> id >> goal >> maxLen >> slack >> maxSols >> nodeLimit >> setName >> nt;
      toks.assign(nt, 0);
      for (int i = 0; i < nt; i++) cin >> toks[i];
      cin >> n;
      vector<S> starts;
      for (int i = 0; i < n; i++) starts.push_back(fromCubie(readCubie(cin)));
      cur = tablesFor(setName, goal, toks);
      compactTables(toks);
      int lo = 99;
      for (auto &s : starts) lo = min(lo, h(s));
      nodes = 0; truncated = false; found = 0; outBuf.clear();
      int opt = lo;
      for (; opt <= maxLen; opt++) {
        bool any = false;
        for (auto &s : starts) { pathLen = 0; if (dfs(s, 0, 0, opt, -1, false)) { any = true; break; } }
        if (any || truncated) break;
      }
      int bound = min(opt + slack, maxLen);
      bool solvable = opt <= maxLen && !truncated;
      if (solvable) {
        for (int i = 0; i < (int)starts.size() && !truncated; i++) { pathLen = 0; startIdx = i; dfs(starts[i], 0, 0, bound, -1, true); }
      }
      printf("CASE %s %d %d %lld %d %lld\n", id.c_str(), solvable ? opt : -1, bound, found, truncated ? 1 : 0, nodes);
      fputs(outBuf.c_str(), stdout);
      printf("END %s\n", id.c_str());
      fflush(stdout);
    }
  }
  return 0;
}
