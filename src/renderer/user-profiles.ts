// user-profiles.ts — 10 user profile management with localStorage persistence
// Each profile stores: name, role, company, resume text, JD text

export interface UserProfile {
  id: string;
  name: string;
  role: string;
  company: string;
  resumeText: string;
  jdText: string;
  createdAt: number;
}

const STORAGE_KEY = "kabir_ai_profiles";
const ACTIVE_KEY  = "kabir_ai_active_profile";
const MAX_PROFILES = 10;

// ── Storage helpers ──────────────────────────────────────────────────────────

export function loadProfiles(): UserProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveProfiles(profiles: UserProfile[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
}

export function getActiveProfileId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveProfileId(id: string): void {
  localStorage.setItem(ACTIVE_KEY, id);
}

export function getActiveProfile(): UserProfile | null {
  const id = getActiveProfileId();
  if (!id) return null;
  return loadProfiles().find(p => p.id === id) ?? null;
}

export function upsertProfile(profile: UserProfile): void {
  const profiles = loadProfiles();
  const idx = profiles.findIndex(p => p.id === profile.id);
  if (idx >= 0) {
    profiles[idx] = profile;
  } else {
    if (profiles.length >= MAX_PROFILES) {
      alert(`Maximum ${MAX_PROFILES} profiles allowed.`);
      return;
    }
    profiles.push(profile);
  }
  saveProfiles(profiles);
}

export function deleteProfile(id: string): void {
  const profiles = loadProfiles().filter(p => p.id !== id);
  saveProfiles(profiles);
  if (getActiveProfileId() === id) {
    localStorage.removeItem(ACTIVE_KEY);
  }
}

export function createEmptyProfile(): UserProfile {
  return {
    id: `u_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: "",
    role: "",
    company: "",
    resumeText: "",
    jdText: "",
    createdAt: Date.now(),
  };
}

// ── UI renderer ──────────────────────────────────────────────────────────────

export function renderUserList(
  listEl: HTMLElement,
  formEl: HTMLElement,
  onActivate: (profile: UserProfile) => void,
  editState: { current: UserProfile | null }
): void {
  const profiles = loadProfiles();
  const activeId = getActiveProfileId();
  listEl.innerHTML = "";

  if (profiles.length === 0) {
    const empty = document.createElement("p");
    empty.style.cssText = "font-size:11px;color:var(--text-muted);padding:6px 2px;";
    empty.textContent = "No profiles yet. Click + Add to create one.";
    listEl.appendChild(empty);
    return;
  }

  profiles.forEach(profile => {
    const item = document.createElement("div");
    item.className = "user-item" + (profile.id === activeId ? " active" : "");

    const avatar = document.createElement("div");
    avatar.className = "user-item__avatar";
    avatar.textContent = profile.name ? profile.name[0].toUpperCase() : "?";

    const info = document.createElement("div");
    info.className = "user-item__info";

    const name = document.createElement("div");
    name.className = "user-item__name";
    name.textContent = profile.name || "(No name)";

    const role = document.createElement("div");
    role.className = "user-item__role";
    role.textContent = [profile.role, profile.company].filter(Boolean).join(" · ") || "No role set";

    info.appendChild(name);
    info.appendChild(role);

    const actions = document.createElement("div");
    actions.className = "user-item__actions";

    // Edit button
    const editBtn = document.createElement("button");
    editBtn.className = "user-item__btn";
    editBtn.title = "Edit";
    editBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      editState.current = { ...profile };
      showForm(formEl, profile);
    });

    // Delete button
    const delBtn = document.createElement("button");
    delBtn.className = "user-item__btn user-item__btn--del";
    delBtn.title = "Delete";
    delBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>`;
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm(`Delete profile "${profile.name}"?`)) {
        deleteProfile(profile.id);
        renderUserList(listEl, formEl, onActivate, editState);
      }
    });

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    item.appendChild(avatar);
    item.appendChild(info);
    item.appendChild(actions);

    // Click to activate
    item.addEventListener("click", () => {
      setActiveProfileId(profile.id);
      onActivate(profile);
      renderUserList(listEl, formEl, onActivate, editState);
    });

    listEl.appendChild(item);
  });
}

function showForm(formEl: HTMLElement, profile: UserProfile): void {
  const nameInput    = document.getElementById("userNameInput")    as HTMLInputElement;
  const roleInput    = document.getElementById("userRoleInput")    as HTMLInputElement;
  const companyInput = document.getElementById("userCompanyInput") as HTMLInputElement;
  const resumeInput  = document.getElementById("userResumeInput") as HTMLTextAreaElement;
  const jdInput      = document.getElementById("userJdInput")     as HTMLTextAreaElement;

  nameInput.value    = profile.name;
  roleInput.value    = profile.role;
  companyInput.value = profile.company;
  resumeInput.value  = profile.resumeText;
  jdInput.value      = profile.jdText;

  formEl.style.display = "flex";
  nameInput.focus();
}

export function hideForm(formEl: HTMLElement): void {
  formEl.style.display = "none";
}

export function collectFormData(base: UserProfile): UserProfile {
  return {
    ...base,
    name:       (document.getElementById("userNameInput")    as HTMLInputElement).value.trim(),
    role:       (document.getElementById("userRoleInput")    as HTMLInputElement).value.trim(),
    company:    (document.getElementById("userCompanyInput") as HTMLInputElement).value.trim(),
    resumeText: (document.getElementById("userResumeInput") as HTMLTextAreaElement).value.trim(),
    jdText:     (document.getElementById("userJdInput")     as HTMLTextAreaElement).value.trim(),
  };
}
