import { useEffect, useId, useRef, useState } from 'react';
import { useAuth, useProfile } from '../auth/AuthContext.js';
import { initials } from '../lib/format.js';
import { hrefs } from '../lib/route.js';
import { Icon } from '../ui/Icon.js';

/** Account menu: opens on click, closes on Escape, outside click or choosing an item, and returns focus to its button. */
export function ProfileMenu() {
  const profile = useProfile();
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  async function doSignOut() {
    setBusy(true);
    setFailed(false);
    const ok = await signOut();
    if (!ok) {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div className="rp-menu-wrap" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="rp-avatar-btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="rp-avatar" aria-hidden="true">
          {initials(profile.displayName)}
        </span>
        <span className="rp-avatar-btn__name">{profile.firstName}</span>
        <span className="rp-visually-hidden">Account menu for {profile.displayName}</span>
      </button>
      {open ? (
        <div className="rp-menu" id={menuId} role="group" aria-label="Account">
          <div className="rp-menu__who">
            <div className="rp-menu__name">{profile.displayName}</div>
            <div className="rp-menu__sub rp-num">{profile.phone}</div>
            <div className="rp-menu__sub">{profile.organizationName}</div>
          </div>
          <a className="rp-menu__item" href={hrefs.profile} onClick={() => setOpen(false)}>
            <Icon name="user" />
            Profile
          </a>
          <button
            type="button"
            className="rp-menu__item"
            onClick={() => void doSignOut()}
            disabled={busy}
          >
            <Icon name="logout" />
            {busy ? 'Signing out…' : 'Sign out'}
          </button>
          {failed ? (
            <p className="rp-field__error" role="alert" style={{ padding: '8px 12px' }}>
              <Icon name="alert" />
              We could not sign you out. Check your connection and try again.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
