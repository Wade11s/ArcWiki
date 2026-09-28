# ArcWiki

A local desktop workspace for reading Markdown, maintaining a Wiki, and talking with a local Agent. It is not a browser, an account system, or a cloud wiki.

## Language

**Space**:
A colored knowledge range that groups related Tabs, Pages, and assigned Sources. Its Agent Threads retrieve and use tools within that Space, not across all Spaces.
_Avoid_: Project, folder, workspace account

**Tab**:
A local Markdown note or Agent Thread opened inside a Space. A Tab is not automatically a Wiki Page.
_Avoid_: Browser tab, document window

**Source**:
Captured reference material with its original artifact or retrieval snapshot and an extracted Markdown reading copy. A Source belongs to at most one Space and can inform multiple topics within that Space.

**Page**:
A maintained knowledge entry belonging to a Space, distinct from an original Source. It retains references to its Sources without dividing Pages by human or machine authorship.

**Citation**:
A Page's traceable reference to a Source, which also lets that Source show the Pages that cite it.

**Agent Thread**:
A conversation with the local Agent, shown as a Tab inside one Space. History stays on this device; a global Wiki Thread is a possible later extension.
_Avoid_: Chat, session, ticket

**Agent**:
The local conversation partner that replies in an Agent Thread.
_Avoid_: Assistant account, bot user, cloud agent

**Settings**:
The window for local preferences: Profile, the Agent provider, and reading layout.
_Avoid_: Preferences pane, account console

**Profile**:
The local identity of the person using this workspace — a display name and avatar used in the UI. It is not an account, login, or cloud identity, and it is not sent to the Agent as instructions.
_Avoid_: Account, user account, identity provider

**Avatar**:
The small image in the Agent Thread message column that marks who is speaking. The person's avatar comes from their Profile; the Agent's avatar is the product mark.
_Avoid_: Profile picture URL, gravatar, emoji status
