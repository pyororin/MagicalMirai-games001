/* ============================================================
   ミク(はちゅね)の見た目と仕草のコンポーネント
   ------------------------------------------------------------
   32x40 のドット絵を 1 枚のキャンバスに描き、アプリ側はそれを
   好きな大きさで貼るだけにする。表情・口・腕のポーズ・仕草の
   追加はこのファイルの中だけで完結する(使い方は README.md)。
   アプリからは window.MikuActor 経由で呼ぶ。
   ============================================================ */
(function(global){
  "use strict";

  var W=32, H=40;

  /* ---- 色 ---- */
  var MK={
    hair:"#39C5BB", hair2:"#2A9E96", hair3:"#1F7C76", skin:"#FBE3D4", skin2:"#E9C4B2",
    eye:"#1E3A5F", eyeHi:"#EAF6FF", mouth:"#8E2B47", tongue:"#FF7FA8", blush:"#FFB3C7",
    shirt:"#EDF1FF", shirt2:"#A9B4D6", tie:"#39C5BB", skirt:"#2B3566", skirt2:"#1E2749",
    leg:"#39424F", boot:"#2A9E96", line:"#141A33"
  };

  var cv=null, ctx=null, key="";
  var expr="normal", mouth=0, pose="idle", frame=0;
  var exprUntil=0, poseUntil=0;
  var act=null;                  // 実行中の仕草 {def, at}
  var nextIdleAt=0;              // 次に仕草を出す時刻(間奏用)

  function mp(x,y,w,h,c){ ctx.fillStyle=c; ctx.fillRect(x,y,w,h); }

  /* ---- 表情(目もと)。追加はここに 1 つ関数を足すだけ ---- */
  var EXPRS={
    normal:function(){
      mp(11,9,3,4,MK.eye); mp(19,9,3,4,MK.eye);
      mp(12,9,1,1,MK.eyeHi); mp(20,9,1,1,MK.eyeHi);
    },
    ok:function(){                                  // にっこり(への字の逆)
      mp(11,10,1,1,MK.eye); mp(12,9,2,1,MK.eye); mp(14,10,1,1,MK.eye);
      mp(18,10,1,1,MK.eye); mp(19,9,2,1,MK.eye); mp(21,10,1,1,MK.eye);
    },
    miss:function(){                                // しょんぼり
      mp(11,9,1,1,MK.eye); mp(12,10,1,1,MK.eye); mp(11,11,1,1,MK.eye);
      mp(21,9,1,1,MK.eye); mp(20,10,1,1,MK.eye); mp(21,11,1,1,MK.eye);
      mp(13,9,1,1,MK.eye); mp(19,9,1,1,MK.eye);
    },
    wink:function(){                                // 右目だけ閉じる
      mp(11,9,3,4,MK.eye); mp(12,9,1,1,MK.eyeHi);
      mp(19,11,3,1,MK.eye); mp(19,10,1,1,MK.eye); mp(21,10,1,1,MK.eye);
      mp(20,13,3,1,MK.blush);
    }
  };

  /* ---- 腕のポーズ。frame(0/1)で小さく動かせる ---- */
  var POSES={
    idle:function(){
      mp(9,19,2,6,MK.shirt2); mp(21,19,2,6,MK.shirt2);
      mp(9,25,2,2,MK.skin);   mp(21,25,2,2,MK.skin);
    },
    up:function(){                                   // ヒット:両手を上げる
      mp(8,11,2,8,MK.shirt2); mp(22,11,2,8,MK.shirt2);
      mp(8,10,2,1,MK.line);   mp(22,10,2,1,MK.line);
      mp(8,8,2,2,MK.skin);    mp(22,8,2,2,MK.skin);
    },
    down:function(){                                 // ミス:うなだれる
      mp(9,20,2,7,MK.shirt2); mp(21,20,2,7,MK.shirt2);
      mp(9,27,2,2,MK.skin);   mp(21,27,2,2,MK.skin);
    },
    wave:function(f){                                // 手を振る(左右に1ドット揺れる)
      mp(9,19,2,6,MK.shirt2); mp(9,25,2,2,MK.skin);  // 左手は下げたまま
      var dx=f?1:-1;
      mp(22,13,2,6,MK.shirt2);                       // 右腕を上げる
      mp(22+dx,10,2,3,MK.skin);                      // 手のひら
      mp(22+dx,9,2,1,MK.skin2);
    },
    peace:function(){                                // ピース
      mp(9,19,2,6,MK.shirt2); mp(9,25,2,2,MK.skin);
      mp(22,13,2,6,MK.shirt2);
      mp(22,10,2,3,MK.skin);
      mp(22,7,1,3,MK.skin); mp(24,7,1,3,MK.skin);    // 指2本
    },
    clap:function(f){                                // 手拍子(近づく/離れる)
      var gap=f?0:1;
      mp(11,19,2,5,MK.shirt2); mp(19,19,2,5,MK.shirt2);
      mp(13-gap,22,2,2,MK.skin); mp(17+gap,22,2,2,MK.skin);
    },
    hi:function(){                                   // 片手を高く挙げる(呼びかけ)
      mp(9,19,2,6,MK.shirt2); mp(9,25,2,2,MK.skin);
      mp(22,9,2,10,MK.shirt2);
      mp(22,6,2,3,MK.skin);
    }
  };

  /* ---- 間奏で出す仕草。ここに 1 行足せば増える ---- */
  var GESTURES=[
    {name:"wave",  pose:"wave",  expr:"ok",     ms:1500, fps:5},
    {name:"wink",  pose:"idle",  expr:"wink",   ms:1000, fps:0},
    {name:"peace", pose:"peace", expr:"ok",     ms:1300, fps:0},
    {name:"clap",  pose:"clap",  expr:"ok",     ms:1400, fps:6},
    {name:"hi",    pose:"hi",    expr:"normal", ms:1200, fps:0}
  ];

  function drawBody(){
    ctx.clearRect(0,0,W,H);
    // ツインテール(左右)。房を3段に分けて陰影を付ける
    mp(4,6,4,12,MK.hair);   mp(24,6,4,12,MK.hair);
    mp(4,18,4,6,MK.hair2);  mp(24,18,4,6,MK.hair2);
    mp(5,24,3,4,MK.hair2);  mp(24,24,3,4,MK.hair2);
    mp(5,28,3,2,MK.hair3);  mp(24,28,3,2,MK.hair3);
    mp(4,5,4,2,MK.hair3);   mp(24,5,4,2,MK.hair3);   // 結び目
    // 頭
    mp(10,2,12,3,MK.hair);
    mp(9,3,14,3,MK.hair);
    mp(9,6,14,10,MK.skin);
    mp(9,5,14,1,MK.hair2);
    mp(8,6,1,9,MK.hair2); mp(23,6,1,9,MK.hair2);
    mp(9,16,14,1,MK.skin2);
    mp(9,6,14,2,MK.hair);                    // 前髪
    mp(12,8,3,1,MK.hair); mp(17,8,3,1,MK.hair);
    mp(10,12,2,1,MK.blush); mp(20,12,2,1,MK.blush);
    // 目
    (EXPRS[expr]||EXPRS.normal)();
    // 口
    if(mouth<=0){ mp(15,14,2,1,MK.mouth); }
    else if(mouth===1){ mp(15,14,3,2,MK.mouth); mp(15,14,3,1,MK.tongue); }
    else { mp(14,13,5,4,MK.mouth); mp(15,15,3,1,MK.tongue); }
    // 首と肩
    mp(15,17,3,1,MK.skin2);
    mp(11,18,10,7,MK.shirt);
    mp(11,18,10,1,MK.tie);                    // 襟
    mp(15,19,2,4,MK.tie);                     // ネクタイ
    mp(11,24,10,1,MK.shirt2);
    // 腕
    (POSES[pose]||POSES.idle)(frame);
    // スカート・脚・ブーツ
    mp(10,25,12,4,MK.skirt);
    mp(9,28,14,2,MK.skirt2);
    mp(13,30,2,5,MK.leg); mp(17,30,2,5,MK.leg);
    mp(12,35,4,3,MK.boot); mp(16,35,4,3,MK.boot);
    mp(12,38,4,1,MK.line); mp(16,38,4,1,MK.line);
  }

  var API={
    /** 32x40 のキャンバスを受け取って初期化する */
    init:function(canvas){
      cv=canvas; cv.width=W; cv.height=H;
      ctx=cv.getContext("2d");
      key=""; API.render();
      return API;
    },
    canvas:function(){ return cv; },
    size:function(){ return {w:W, h:H}; },

    setMouth:function(n){ mouth=n|0; },
    setExpr:function(name, ms){ expr=name; if(ms) exprUntil=performance.now()+ms; },
    setPose:function(name, ms){ pose=name; if(ms) poseUntil=performance.now()+ms; },

    /** 判定への反応(打てた/取りこぼした) */
    react:function(grade){
      var miss=(grade==="MISS");
      API.setExpr(miss?"miss":"ok", 520);
      API.setPose(miss?"down":"up", 520);
      act=null;                                 // 仕草より判定の反応を優先する
      API.render();
    },

    /** 仕草を1つ再生する(名前を省くとランダム) */
    playGesture:function(name){
      var def=null;
      if(name) for(var i=0;i<GESTURES.length;i++){ if(GESTURES[i].name===name) def=GESTURES[i]; }
      if(!def) def=GESTURES[Math.floor(Math.random()*GESTURES.length)];
      act={def:def, at:performance.now()};
      expr=def.expr; pose=def.pose; frame=0;
      return def.name;
    },
    gestureNames:function(){ return GESTURES.map(function(g){ return g.name; }); },

    /** 毎フレーム呼ぶ。表情の期限切れ・仕草の進行・間奏の自動仕草をまとめて見る
        opts: {singing:歌詞が鳴っている, playing:プレイ中, idle:自動仕草を出すか} */
    tick:function(now, opts){
      opts=opts||{};
      if(act){                                   // 仕草の進行
        var age=now-act.at;
        if(age>=act.def.ms){ act=null; expr="normal"; pose="idle"; frame=0;
                             nextIdleAt=now+1200+Math.random()*2600; }
        else if(act.def.fps) frame=Math.floor(age/(1000/act.def.fps))%2;
      } else {
        if(exprUntil && now>exprUntil){ expr="normal"; exprUntil=0; }
        if(poseUntil && now>poseUntil){ pose="idle";   poseUntil=0; }
        /* 間奏(歌詞が鳴っていない)で、プレイ中なら、ときどき仕草を出す */
        if(opts.idle!==false && opts.playing && !opts.singing){
          if(!nextIdleAt) nextIdleAt=now+1500;
          else if(now>nextIdleAt) API.playGesture();
        } else if(opts.singing) nextIdleAt=0;
      }
      API.render();
    },

    /** 拍に合わせた跳ね(0〜1程度)。呼び出し側でドット単位に換算する。
        1 拍おき(奇数拍)に跳ねる。小節頭だけだと落ち着きすぎて見えたため、
        build 42 で頻度を倍にした。3拍子なら 1,3 拍 → 次の小節は 2 拍目、と
        小節をまたいで表裏が入れ替わるので、単調にならない。
        揺れ(idle)も跳ねに合わせて倍の速さにする。 */
    bounce:function(beatPulse, beatPosition, calm){
      var idle = calm ? 0.5 : (Math.sin(performance.now()/310)+1)/2;
      var hop = (beatPosition==null || beatPosition%2===1) ? (beatPulse||0) : 0;
      return hop + idle*0.3;
    },

    /** 見た目が変わったときだけ描き直す */
    render:function(){
      if(!ctx) return;
      var k=expr+"/"+mouth+"/"+pose+"/"+frame;
      if(k===key) return;
      key=k; drawBody();
    },
    /** 検証・デバッグ用に今の見た目を返す */
    peek:function(){ return {expr:expr, mouth:mouth, pose:pose, frame:frame,
                             gesture:act?act.def.name:null}; },
    reset:function(){ act=null; expr="normal"; pose="idle"; mouth=0; frame=0;
                      exprUntil=0; poseUntil=0; nextIdleAt=0; API.render(); }
  };

  global.MikuActor=API;
})(window);
