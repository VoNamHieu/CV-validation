'use client';

import { useState, useEffect } from 'react';
import {
    Play, Pause, FilePdf, CheckCircle, Brain, GlobeHemisphereWest,
    MagnifyingGlass, Buildings, Briefcase, MagicWand, DownloadSimple,
} from '@phosphor-icons/react';
import { DEMO_SCENES, DEMO_JOBS, DEMO_SOURCES } from './Landing.data';

export default function DemoPlayer() {
    const [scene, setScene] = useState(0);
    const [paused, setPaused] = useState(false);
    const [reduced, setReduced] = useState(false);

    useEffect(() => {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        const update = () => setReduced(mq.matches);
        update();
        mq.addEventListener('change', update);
        return () => mq.removeEventListener('change', update);
    }, []);

    useEffect(() => {
        if (paused || reduced) return;
        const id = setTimeout(
            () => setScene((s) => (s + 1) % DEMO_SCENES.length),
            DEMO_SCENES[scene].ms,
        );
        return () => clearTimeout(id);
    }, [scene, paused, reduced]);

    return (
        <div
            className="lp-demo-frame"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
        >
            <div className="lp-mock-bar">
                <span className="lp-mock-dot" style={{ background: '#ff5f57' }} />
                <span className="lp-mock-dot" style={{ background: '#febc2e' }} />
                <span className="lp-mock-dot" style={{ background: '#28c840' }} />
                <span className="lp-mock-url">copo.ai · Demo</span>
                <button
                    className="lp-demo-play"
                    onClick={() => setPaused((p) => !p)}
                    aria-label={paused ? 'Phát demo' : 'Tạm dừng demo'}
                >
                    {paused ? <Play size={12} weight="fill" /> : <Pause size={12} weight="fill" />}
                </button>
            </div>

            <div className="lp-demo-stage">
                {/* Scene 1 — Tải CV */}
                <div className={`lp-scene ${scene === 0 ? 'is-on' : ''}`} aria-hidden={scene !== 0}>
                    <div className="lp-drop">
                        <div className="lp-drop-card">
                            <FilePdf size={26} weight="duotone" />
                            <div>
                                <div className="lp-drop-name">Nguyen_Van_A_CV.pdf</div>
                                <div className="lp-drop-meta">AI đang đọc kỹ năng & kinh nghiệm…</div>
                            </div>
                            <span className="lp-scan-line" />
                        </div>
                        <div className="lp-chips">
                            {['React', 'TypeScript', '5 năm KN', 'Frontend', 'Team lead'].map((c, i) => (
                                <span key={c} className="lp-chip2" style={{ animationDelay: `${0.5 + i * 0.28}s` }}>
                                    <CheckCircle size={11} weight="fill" /> {c}
                                </span>
                            ))}
                        </div>
                        <div className="lp-role-out">
                            <Brain size={14} weight="duotone" /> Vai trò mục tiêu: <b>Senior Frontend Engineer</b>
                        </div>
                    </div>
                </div>

                {/* Scene 2 — Tìm việc khắp nơi */}
                <div className={`lp-scene ${scene === 1 ? 'is-on' : ''}`} aria-hidden={scene !== 1}>
                    <div className="lp-search">
                        <div className="lp-radar">
                            <GlobeHemisphereWest size={34} weight="duotone" />
                            <span className="lp-ping" /><span className="lp-ping lp-ping-2" />
                            {scene === 1 && <span className="lp-radar-sweep" />}
                        </div>
                        <div className="lp-search-side">
                            <div className="lp-search-head">
                                <MagnifyingGlass size={14} weight="bold" /> Đang tìm việc phù hợp ở khắp nơi…
                            </div>
                            {DEMO_SOURCES.map((src, i) => (
                                <div key={src} className="lp-src" style={{ animationDelay: `${0.3 + i * 0.5}s` }}>
                                    <Buildings size={13} weight="duotone" />
                                    <span className="lp-src-name">{src}</span>
                                    <CheckCircle size={14} weight="fill" className="lp-src-ok" />
                                </div>
                            ))}
                            <div className="lp-search-count">
                                <b>132</b> vị trí · <b>24</b> công ty đang tuyển
                            </div>
                        </div>
                    </div>
                </div>

                {/* Scene 3 — Chấm điểm độ khớp */}
                <div className={`lp-scene ${scene === 2 ? 'is-on' : ''}`} aria-hidden={scene !== 2}>
                    <div className="lp-score-scene">
                        <div className="lp-mock-score">
                            <div className="lp-ring"><span className="lp-ring-num">92<small>%</small></span></div>
                            <div>
                                <div className="lp-mock-role">Senior Frontend Engineer</div>
                                <div className="lp-mock-co"><Briefcase size={12} weight="duotone" /> One Mount · Hà Nội</div>
                                <span className="lp-chip lp-chip-green"><CheckCircle size={11} weight="fill" /> Độ khớp rất cao</span>
                            </div>
                        </div>
                        {DEMO_JOBS.slice(1).map((j, i) => (
                            <div key={j.t} className="lp-job lp-job-anim" style={{ animationDelay: `${0.2 + i * 0.2}s` }}>
                                <div className="lp-job-info">
                                    <span className="lp-job-title">{j.t}</span>
                                    <span className="lp-job-meta">{j.co}</span>
                                </div>
                                <div className="lp-bar">
                                    <span style={{ width: scene === 2 ? `${j.s}%` : '0%', background: j.c }} />
                                </div>
                                <span className="lp-job-score">{j.s}%</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Scene 4 — Tối ưu CV */}
                <div className={`lp-scene ${scene === 3 ? 'is-on' : ''}`} aria-hidden={scene !== 3}>
                    <div className="lp-cv-scene">
                        <div className="lp-cv-doc">
                            <div className="lp-cv-h" />
                            <div className="lp-cv-line lp-cv-hl" style={{ animationDelay: '.3s' }} />
                            <div className="lp-cv-line" style={{ width: '92%' }} />
                            <div className="lp-cv-line lp-cv-hl" style={{ animationDelay: '.7s', width: '78%' }} />
                            <div className="lp-cv-line" style={{ width: '88%' }} />
                            <div className="lp-cv-line" style={{ width: '64%' }} />
                            <div className="lp-cv-line lp-cv-hl" style={{ animationDelay: '1.1s', width: '70%' }} />
                        </div>
                        <div className="lp-cv-side">
                            <span className="lp-chip lp-chip-green"><MagicWand size={11} weight="fill" /> Tối ưu cho Senior Frontend Engineer</span>
                            <div className="lp-cv-note"><CheckCircle size={13} weight="fill" /> Viết lại theo JD, không bịa nội dung</div>
                            <div className="lp-cv-note"><CheckCircle size={13} weight="fill" /> Làm nổi bật kỹ năng khớp nhất</div>
                            <button className="lp-cv-export"><DownloadSimple size={14} weight="bold" /> Xuất PDF</button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Timeline */}
            <div className="lp-timeline">
                {DEMO_SCENES.map((sc, i) => {
                    const Icon = sc.icon;
                    return (
                        <button
                            key={sc.label}
                            className={`lp-tl-tab ${scene === i ? 'is-active' : ''}`}
                            onClick={() => setScene(i)}
                        >
                            <span className="lp-tl-label"><Icon size={13} weight="duotone" /> {sc.label}</span>
                            <span className="lp-tl-track">
                                <span
                                    className="lp-tl-fill"
                                    style={
                                        scene === i && !paused && !reduced
                                            ? { animation: `lp-tl-grow ${sc.ms}ms linear forwards` }
                                            : { width: scene > i ? '100%' : scene === i ? '100%' : '0%' }
                                    }
                                />
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
