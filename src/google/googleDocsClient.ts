import { createSheetsAccessToken, DRIVE_FILE_SCOPE } from '../sheets/sheetAuth';

export type ProfileDocInput = { folderId: string; key: string; title: string; text: string };
export type GoogleDocsClient = { save(input: ProfileDocInput): Promise<string> };
type Document = { revisionId?: string; body?: { content?: Array<{ endIndex?: number; paragraph?: { elements?: Array<{textRun?: {content?: string}}> } }> } };
const DRIVE = 'https://www.googleapis.com/drive/v3';
const DOCS = 'https://docs.googleapis.com/v1/documents';

export function createGoogleDocsClient(options: { fetch?: typeof globalThis.fetch; getAccessToken?: () => Promise<string> } = {}): GoogleDocsClient {
  const fetch = options.fetch ?? globalThis.fetch;
  // drive.file is accepted by Docs as well; do not request all Drive/Docs access.
  const token = options.getAccessToken ?? (() => createSheetsAccessToken(undefined, undefined, [DRIVE_FILE_SCOPE]));
  async function request<T>(api: 'Drive' | 'Docs', url: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${await token()}`, ...(init.body ? {'Content-Type':'application/json'} : {}) } });
    const body = await response.json() as T & { error?: {message?: string} };
    if (!response.ok) throw new Error(`Google ${api} API ${response.status}: ${body.error?.message ?? response.statusText}`);
    return body;
  }
  return {
    async save(input) {
      if (!/^[\w-]+$/.test(input.folderId)) throw new Error('PROFILE_DOCS_FOLDER_ID must be a Google Drive folder ID.');
      if (!/^[\w-]+$/.test(input.key) || !input.text.trim() || !input.title.trim()) throw new Error('Invalid profile document input.');
      let folder: { mimeType?:string;driveId?:string;capabilities?:{canAddChildren?:boolean} };
      try {
        folder = await request('Drive', `${DRIVE}/files/${input.folderId}?supportsAllDrives=true&fields=id,mimeType,driveId,capabilities(canAddChildren)`);
      } catch (error) {
        throw new Error(`Cannot access PROFILE_DOCS_FOLDER_ID. Share the shared-drive folder with the service account. ${error instanceof Error ? error.message : String(error)}`);
      }
      if (folder.mimeType !== 'application/vnd.google-apps.folder') throw new Error('PROFILE_DOCS_FOLDER_ID is not a folder.');
      if (!folder.driveId) throw new Error('PROFILE_DOCS_FOLDER_ID must be in a shared drive: service accounts have no personal storage quota.');
      if (!folder.capabilities?.canAddChildren) throw new Error('Service account needs write permission on PROFILE_DOCS_FOLDER_ID.');
      const query = `'${input.folderId}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.document' and appProperties has { key='profileSource' and value='${input.key}' }`;
      const existing = await request<{files?:Array<{id?:string;name?:string}>;nextPageToken?:string}>('Drive',
        `${DRIVE}/files?${new URLSearchParams({q:query,fields:'files(id,name),nextPageToken',supportsAllDrives:'true',includeItemsFromAllDrives:'true',corpora:'drive',driveId:folder.driveId,pageSize:'2'})}`);
      if ((existing.files?.length ?? 0) > 1 || existing.nextPageToken) throw new Error('Multiple profile Docs found; manual review required.');
      let id = existing.files?.[0]?.id;
      if (!id) {
        const created = await request<{id?:string}>('Drive', `${DRIVE}/files?supportsAllDrives=true&fields=id`, {
          method:'POST', body:JSON.stringify({name:input.title,mimeType:'application/vnd.google-apps.document',parents:[input.folderId],appProperties:{profileSource:input.key}})
        });
        id = created.id;
      }
      if (!id || !/^[\w-]+$/.test(id)) throw new Error('Drive did not return a valid document ID.');
      const previousName = existing.files?.[0]?.name;
      if (previousName !== undefined && previousName !== input.title) {
        const renamed = await request<{name?:string}>('Drive',`${DRIVE}/files/${id}?supportsAllDrives=true&fields=name`,{
          method:'PATCH',body:JSON.stringify({name:input.title})
        });
        if (renamed.name !== input.title) throw new Error('Drive did not confirm the profile document name.');
      }
      const url = `${DOCS}/${id}`;
      const doc = await request<Document>('Docs', url);
      if (documentText(doc) !== input.text + '\n') {
        if (!doc.revisionId) throw new Error('Docs did not return a revision; refusing unguarded update.');
        const endIndex = doc.body?.content?.at(-1)?.endIndex;
        if (!endIndex || endIndex < 2) throw new Error('Invalid Docs body structure.');
        const requests: unknown[] = [];
        if (endIndex > 2) requests.push({deleteContentRange:{range:{startIndex:1,endIndex:endIndex-1}}});
        requests.push({insertText:{location:{index:1},text:input.text}});
        await request('Docs', `${url}:batchUpdate`, {method:'POST',body:JSON.stringify({requests,writeControl:{requiredRevisionId:doc.revisionId}})});
        if (documentText(await request<Document>('Docs', url)) !== input.text + '\n') throw new Error('Docs did not confirm the saved profile text.');
      }
      return `https://docs.google.com/document/d/${id}/edit`;
    }
  };
}

function documentText(doc: Document): string {
  return (doc.body?.content ?? []).flatMap(c => c.paragraph?.elements ?? []).map(e => e.textRun?.content ?? '').join('');
}
