'use client';

// Landing contact section + form. Anonymous submit → /api/feedback/contact →
// backend POST /feedback/contact → lands in the same feedback table the admin
// "Góp ý" panel reads (source='contact'). Uses the landing's lp-* classes
// (defined in Landing.styles.ts, injected globally by Landing's <style>).
import { useState } from 'react';
import { PaperPlaneTilt, CheckCircle, EnvelopeSimple } from '@phosphor-icons/react';

type Status = 'idle' | 'sending' | 'sent' | 'error';

export default function LandingContact() {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [message, setMessage] = useState('');
    const [status, setStatus] = useState<Status>('idle');
    const [err, setErr] = useState('');

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (status === 'sending') return;
        const n = name.trim(), em = email.trim(), m = message.trim();
        if (!n || !em || m.length < 2) {
            setErr('Vui lòng điền đủ tên, email và nội dung.');
            setStatus('error');
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
            setErr('Email chưa hợp lệ.');
            setStatus('error');
            return;
        }
        setStatus('sending');
        setErr('');
        try {
            const res = await fetch('/api/feedback/contact', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: n, email: em, message: m,
                    page_url: typeof window !== 'undefined' ? window.location.href : undefined,
                }),
            });
            if (!res.ok) throw new Error('fail');
            setStatus('sent');
            setName(''); setEmail(''); setMessage('');
        } catch {
            setErr('Không gửi được, thử lại sau nhé.');
            setStatus('error');
        }
    };

    return (
        <section className="lp-contact" id="lien-he">
            <div className="lp-contact-inner">
                <div className="lp-contact-intro">
                    <span className="lp-contact-eyebrow">Liên hệ</span>
                    <h2 className="lp-contact-title">Cần hỗ trợ hay hợp tác</h2>
                    <p className="lp-contact-sub">
                        Gửi tin nhắn cho đội ngũ Copo về góp ý, câu hỏi, hay đề xuất hợp tác.
                        Chúng tôi sẽ phản hồi qua email trong thời gian sớm nhất.
                    </p>
                    <a className="lp-contact-mail" href="mailto:charles@copoai.net">
                        <EnvelopeSimple size={16} weight="duotone" /> charles@copoai.net
                    </a>
                </div>

                {status === 'sent' ? (
                    <div className="lp-contact-done">
                        <CheckCircle size={40} weight="fill" />
                        <h3>Đã gửi, cảm ơn bạn!</h3>
                        <p>Chúng tôi sẽ liên hệ lại qua email sớm nhất.</p>
                        <button type="button" className="lp-contact-again" onClick={() => setStatus('idle')}>
                            Gửi tin khác
                        </button>
                    </div>
                ) : (
                    <form className="lp-contact-form" onSubmit={submit} noValidate>
                        <div className="lp-contact-fields">
                            <label className="lp-field">
                                <span>Họ và tên</span>
                                <input value={name} onChange={(e) => setName(e.target.value)}
                                    placeholder="Nguyễn Văn A" maxLength={120} autoComplete="name" />
                            </label>
                            <label className="lp-field">
                                <span>Email</span>
                                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                                    placeholder="ban@email.com" maxLength={200} autoComplete="email" />
                            </label>
                        </div>
                        <label className="lp-field">
                            <span>Nội dung</span>
                            <textarea value={message} onChange={(e) => setMessage(e.target.value)}
                                rows={4} placeholder="Bạn cần hỗ trợ điều gì?" maxLength={4000} />
                        </label>
                        {status === 'error' && <div className="lp-contact-err">{err}</div>}
                        <button type="submit" className="lp-btn-primary lp-btn-lg lp-contact-submit"
                            disabled={status === 'sending'}>
                            <PaperPlaneTilt size={17} weight="fill" />
                            {status === 'sending' ? 'Đang gửi…' : 'Gửi tin nhắn'}
                        </button>
                    </form>
                )}
            </div>
        </section>
    );
}
