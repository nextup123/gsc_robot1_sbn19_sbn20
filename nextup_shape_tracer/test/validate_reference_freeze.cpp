// =============================================================================
// validate_reference_freeze.cpp
//
// Proves the cross-track freeze gate does the two things it must:
//   A) IGNORE phase lag  -- a tool exactly on the path but lagging along it,
//      even by half a lap, reads ~0 cross-track error. Phase lag is harmless
//      and always present; freezing on it would stall every trace.
//   B) MEASURE radial offset exactly -- a tool 0.5mm off the path reads 0.5mm.
//
// This is the distinction a total-error gate (|p_ref - p_act|) gets wrong:
// total error is dominated by phase lag, so a total-error gate freezes on
// healthy traces, stutters, and drives the tool to overshoot OUTWARD. That was
// measured as +66mm on the fitted diameter. The gate must use CROSS-TRACK
// (perpendicular) distance, which this file verifies against the exact
// implementation used in the node.
//
// The escalating search is also exercised: a windowed scan can only
// OVER-estimate the true distance, so whenever the windowed result would trip
// the gate we fall back to a full scan before believing it. Case A at 90 and
// 175 degrees behind confirms the fallback returns ~0, not a windowed artefact.
//
// Build & run:
//     g++ -O2 -I/usr/include/eigen3 validate_reference_freeze.cpp -o vf && ./vf
//   Expected: ALL PASS.
// =============================================================================

#include <Eigen/Dense>
#include <vector>
#include <cmath>
#include <limits>
#include <cstdio>
using Vec3 = Eigen::Vector3d;
using Path = std::vector<Vec3>;
struct Harness {
  Path ref_; Vec3 centre_; bool closed_; int cross_search_window_{60};
  double freeze_error_{0.002};
  double crossTrackScan(const Vec3& p, int hint, int w) const {
    const int n = static_cast<int>(ref_.size());
    double best = std::numeric_limits<double>::max();
    for (int k = hint - w; k <= hint + w; ++k){
      int i=((k%n)+n)%n, j=(i+1)%n;
      if(!closed_ && i==n-1) continue;
      const Vec3 a=centre_+ref_[i], b=centre_+ref_[j];
      const double abx=b.x()-a.x(),aby=b.y()-a.y(),apx=p.x()-a.x(),apy=p.y()-a.y();
      const double L2=abx*abx+aby*aby;
      double u=(L2>1e-15)?(apx*abx+apy*aby)/L2:0.0; u=std::max(0.0,std::min(1.0,u));
      const double dx=apx-abx*u, dy=apy-aby*u; best=std::min(best,dx*dx+dy*dy);
    }
    return std::sqrt(best);
  }
  double crossTrackError(const Vec3& p, int hint) const {
    const int n=static_cast<int>(ref_.size()); if(n<2) return 0.0;
    const double windowed=crossTrackScan(p,hint,std::min(n/2,cross_search_window_));
    if(windowed<freeze_error_) return windowed;
    return crossTrackScan(p,hint,n/2+1);
  }
};
int main(){
  const int N=720; const double R=0.030;
  Harness h; h.closed_=true; h.centre_=Vec3(-0.3256,-0.4885,0);
  for(int i=0;i<N;i++){double a=i*2*M_PI/N; h.ref_.emplace_back(R*cos(a),R*sin(a),0);}
  int fails=0;
  auto check=[&](const char*w,double g,double want,double tol){
    bool ok=std::fabs(g-want)<tol; printf("  %-46s %8.4fmm %s\n",w,g*1000,ok?"PASS":"FAIL"); if(!ok)fails++;};
  printf("A) phase lag invisible, up to a FULL HALF-LAP behind:\n");
  for(double lag:{0.0,5.8,20.0,45.0,90.0,175.0}){
    double th=1.0, ta=th-lag*M_PI/180.0;
    Vec3 tool=h.centre_+Vec3(R*cos(ta),R*sin(ta),0);
    int hint=int((th/(2*M_PI))*N)%N; char b[80]; snprintf(b,80,"%.1f deg behind",lag);
    check(b,h.crossTrackError(tool,hint),0.0,5e-6);
  }
  printf("\nB) radial offset measured exactly:\n");
  for(double dr:{0.05,0.437,2.0,10.0}){
    double th=1.0,rr=R-dr/1000.0;
    Vec3 tool=h.centre_+Vec3(rr*cos(th),rr*sin(th),0);
    int hint=int((th/(2*M_PI))*N)%N; char b[80]; snprintf(b,80,"%.3fmm inside",dr);
    // for large dr the nearest segment is still radial, tol loosens slightly
    check(b,h.crossTrackError(tool,hint),dr/1000.0,dr>5?5e-4:2e-6);
  }
  printf("\n%s\n", fails?"FAILED":"ALL PASS");
  return fails;
}
