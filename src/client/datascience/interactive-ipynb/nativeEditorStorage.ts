import { nbformat } from '@jupyterlab/coreutils';
import { inject, injectable, named } from 'inversify';
import * as path from 'path';
import * as uuid from 'uuid/v4';
import { Event, EventEmitter, Memento, Uri } from 'vscode';
import { concatMultilineStringInput, splitMultilineString } from '../../../datascience-ui/common';
import { createCodeCell } from '../../../datascience-ui/common/cellFactory';
import { ICommandManager } from '../../common/application/types';
import { traceError } from '../../common/logger';
import { IFileSystem } from '../../common/platform/types';
import { GLOBAL_MEMENTO, ICryptoUtils, IExtensionContext, IMemento, WORKSPACE_MEMENTO } from '../../common/types';
import * as localize from '../../common/utils/localize';
import { noop } from '../../common/utils/misc';
import { PythonInterpreter } from '../../interpreter/contracts';
import { Commands, Identifiers } from '../constants';
import { IEditCell, IInsertCell, ISwapCells } from '../interactive-common/interactiveWindowTypes';
import { InvalidNotebookFileError } from '../jupyter/invalidNotebookFileError';
import { LiveKernelModel } from '../jupyter/kernels/types';
import { CellState, ICell, IJupyterExecution, IJupyterKernelSpec, ILoadableNotebookStorage, INotebookStorage } from '../types';

// tslint:disable-next-line:no-require-imports no-var-requires
import detectIndent = require('detect-indent');

const KeyPrefix = 'notebook-storage-';
const NotebookTransferKey = 'notebook-transfered';

@injectable()
export class NativeEditorStorage implements INotebookStorage, ILoadableNotebookStorage {
    public get isDirty(): boolean {
        return this._isDirty;
    }
    public get changed(): Event<void> {
        return this._changedEmitter.event;
    }
    public get file(): Uri {
        return this._file;
    }

    public get isUntitled(): boolean {
        const baseName = path.basename(this.file.fsPath);
        return baseName.includes(localize.DataScience.untitledNotebookFileName());
    }
    private static signedUpForCommands = false;

    private static storageMap = new Map<string, NativeEditorStorage>();
    private _changedEmitter = new EventEmitter<void>();
    private _cells: ICell[] = [];
    private _loadPromise: Promise<ICell[]> | undefined;
    private _loaded = false;
    private _file: Uri = Uri.file('');
    private _isDirty: boolean = false;
    private indentAmount: string = ' ';
    private notebookJson: Partial<nbformat.INotebookContent> = {};

    constructor(
        @inject(IJupyterExecution) private jupyterExecution: IJupyterExecution,
        @inject(IFileSystem) private fileSystem: IFileSystem,
        @inject(ICryptoUtils) private crypto: ICryptoUtils,
        @inject(IExtensionContext) private context: IExtensionContext,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private globalStorage: Memento,
        @inject(IMemento) @named(WORKSPACE_MEMENTO) private localStorage: Memento,
        @inject(ICommandManager) cmdManager: ICommandManager
    ) {
        // Sign up for commands if this is the first storage created.
        if (!NativeEditorStorage.signedUpForCommands) {
            NativeEditorStorage.registerCommands(cmdManager);
        }
    }

    private static registerCommands(commandManager: ICommandManager): void {
        NativeEditorStorage.signedUpForCommands = true;
        commandManager.registerCommand(Commands.NotebookStorage_ClearCellOutputs, NativeEditorStorage.handleClearAllOutputs);
        commandManager.registerCommand(Commands.NotebookStorage_Close, NativeEditorStorage.handleClose);
        commandManager.registerCommand(Commands.NotebookStorage_DeleteAllCells, NativeEditorStorage.handleDeleteAllCells);
        commandManager.registerCommand(Commands.NotebookStorage_EditCell, NativeEditorStorage.handleEdit);
        commandManager.registerCommand(Commands.NotebookStorage_InsertCell, NativeEditorStorage.handleInsert);
        commandManager.registerCommand(Commands.NotebookStorage_ModifyCells, NativeEditorStorage.handleModifyCells);
        commandManager.registerCommand(Commands.NotebookStorage_RemoveCell, NativeEditorStorage.handleRemoveCell);
        commandManager.registerCommand(Commands.NotebookStorage_SwapCells, NativeEditorStorage.handleSwapCells);
        commandManager.registerCommand(Commands.NotebookStorage_Save, NativeEditorStorage.handleSave);
        commandManager.registerCommand(Commands.NotebookStorage_SaveAs, NativeEditorStorage.handleSaveAs);
        commandManager.registerCommand(Commands.NotebookStorage_UpdateVersion, NativeEditorStorage.handleUpdateVersionInfo);
    }

    private static async getStorage(resource: Uri): Promise<NativeEditorStorage | undefined> {
        const storage = NativeEditorStorage.storageMap.get(resource.fsPath);
        if (storage && storage._loadPromise) {
            await storage._loadPromise;
            return storage;
        }
        return undefined;
    }

    private static handleCallback(resource: Uri, callback: (storage: NativeEditorStorage) => Promise<void>): Promise<void> {
        return NativeEditorStorage.getStorage(resource).then(s => {
            if (s) {
                return callback(s);
            }
        });
    }

    private static async handleEdit(resource: Uri, request: IEditCell): Promise<void> {
        return NativeEditorStorage.handleCallback(resource, async s => {
            // Apply the changes to the visible cell list. We won't get an update until
            // submission otherwise
            if (request.changes && request.changes.length) {
                const change = request.changes[0];
                const normalized = change.text.replace(/\r/g, '');

                // Figure out which cell we're editing.
                const cell = s._cells.find(c => c.id === request.id);
                if (cell) {
                    // This is an actual edit.
                    const contents = concatMultilineStringInput(cell.data.source);
                    const before = contents.substr(0, change.rangeOffset);
                    const after = contents.substr(change.rangeOffset + change.rangeLength);
                    const newContents = `${before}${normalized}${after}`;
                    if (contents !== newContents) {
                        cell.data.source = newContents;
                        return s.setDirty();
                    }
                }
            }
        });
    }

    private static async handleInsert(resource: Uri, request: IInsertCell): Promise<void> {
        return NativeEditorStorage.handleCallback(resource, async s => {
            // Insert a cell into our visible list based on the index. They should be in sync
            s._cells.splice(request.index, 0, request.cell);
            return s.setDirty();
        });
    }

    private static async handleRemoveCell(resource: Uri, id: string): Promise<void> {
        // Filter our list
        return NativeEditorStorage.handleCallback(resource, async s => {
            s._cells = s._cells.filter(v => v.id !== id);
            return s.setDirty();
        });
    }

    private static async handleSwapCells(resource: Uri, request: ISwapCells): Promise<void> {
        // Swap two cells in our list
        return NativeEditorStorage.handleCallback(resource, async s => {
            const first = s._cells.findIndex(v => v.id === request.firstCellId);
            const second = s._cells.findIndex(v => v.id === request.secondCellId);
            if (first >= 0 && second >= 0) {
                const temp = { ...s._cells[first] };
                s._cells[first] = s._cells[second];
                s._cells[second] = temp;
                return s.setDirty();
            }
        });
    }

    private static handleDeleteAllCells(resource: Uri): Promise<void> {
        return NativeEditorStorage.handleCallback(resource, async s => {
            s._cells = [];
            return s.setDirty();
        });
    }

    private static handleClearAllOutputs(resource: Uri): Promise<void> {
        return NativeEditorStorage.handleCallback(resource, async s => {
            s._cells.forEach(cell => {
                cell.data.execution_count = null;
                cell.data.outputs = [];
            });
            return s.setDirty();
        });
    }

    private static async handleModifyCells(resource: Uri, cells: ICell[]): Promise<void> {
        return NativeEditorStorage.handleCallback(resource, async s => {
            // Update these cells in our list
            cells.forEach(c => {
                const index = s._cells.findIndex(v => v.id === c.id);
                s._cells[index] = c;
            });

            // Indicate dirty
            return s.setDirty();
        });
    }

    private static async handleSave(resource: Uri, cells: ICell[] | undefined): Promise<void> {
        return NativeEditorStorage.handleCallback(resource, async s => {
            return NativeEditorStorage.handleSaveAs(s._file, s._file, cells);
        });
    }

    private static async handleSaveAs(resource: Uri, newFile: Uri, cells: ICell[] | undefined): Promise<void> {
        return NativeEditorStorage.handleCallback(resource, async s => {
            const actualCells = cells ? cells : s._cells;
            return s.fileSystem.writeFile(newFile.fsPath, await s.generateNotebookContent(actualCells), { encoding: 'utf-8' });
        });
    }

    private static async handleClose(_resource: Uri): Promise<void> {
        // Don't care about close (used to)
    }

    private static async handleUpdateVersionInfo(
        resource: Uri,
        interpreter: PythonInterpreter | undefined,
        kernelSpec: IJupyterKernelSpec | LiveKernelModel | undefined
    ): Promise<void> {
        return NativeEditorStorage.handleCallback(resource, async s => {
            // Get our kernel_info and language_info from the current notebook
            if (interpreter && interpreter.version && s.notebookJson.metadata && s.notebookJson.metadata.language_info) {
                s.notebookJson.metadata.language_info.version = interpreter.version.raw;
            }

            if (kernelSpec && s.notebookJson.metadata && !s.notebookJson.metadata.kernelspec) {
                // Add a new spec in this case
                s.notebookJson.metadata.kernelspec = {
                    name: kernelSpec.name || kernelSpec.display_name || '',
                    display_name: kernelSpec.display_name || kernelSpec.name || ''
                };
            } else if (kernelSpec && s.notebookJson.metadata && s.notebookJson.metadata.kernelspec) {
                // Spec exists, just update name and display_name
                s.notebookJson.metadata.kernelspec.name = kernelSpec.name || kernelSpec.display_name || '';
                s.notebookJson.metadata.kernelspec.display_name = kernelSpec.display_name || kernelSpec.name || '';
            }
        });
    }
    public async load(file: Uri): Promise<void> {
        // Reset the load promise and reload our cells
        this._loaded = false;
        this._loadPromise = this.loadFromFile(file);
        await this._loadPromise;
    }

    public getCells(): Promise<ICell[]> {
        if (!this._loaded && this._loadPromise) {
            return this._loadPromise;
        }

        // If already loaded, return the updated cell values
        return Promise.resolve(this._cells);
    }

    public async getJson(): Promise<Partial<nbformat.INotebookContent>> {
        await this.ensureNotebookJson();
        return this.notebookJson;
    }

    private async loadFromFile(file: Uri): Promise<ICell[]> {
        // Save file
        this._file = file;

        // Attempt to read the contents
        const contents = await this.fileSystem.readFile(this._file.fsPath);

        // Clear out old global storage the first time somebody opens
        // a notebook
        if (!this.globalStorage.get(NotebookTransferKey)) {
            await this.transferStorage();
        }

        // See if this file was stored in storage prior to shutdown
        const dirtyContents = await this.getStoredContents();
        if (dirtyContents) {
            // This means we're dirty. Indicate dirty and load from this content
            return this.loadContents(dirtyContents, true);
        } else {
            // Load without setting dirty
            return this.loadContents(contents, false);
        }
    }

    private async loadContents(contents: string | undefined, forceDirty: boolean): Promise<ICell[]> {
        // tslint:disable-next-line: no-any
        const json = contents ? (JSON.parse(contents) as any) : undefined;

        // Double check json (if we have any)
        if (json && !json.cells) {
            throw new InvalidNotebookFileError(this.file.fsPath);
        }

        // Then compute indent. It's computed from the contents
        if (contents) {
            this.indentAmount = detectIndent(contents).indent;
        }

        // Then save the contents. We'll stick our cells back into this format when we save
        if (json) {
            this.notebookJson = json;
        }

        // Extract cells from the json
        const cells = contents ? (json.cells as (nbformat.ICodeCell | nbformat.IRawCell | nbformat.IMarkdownCell)[]) : [];

        // Remap the ids
        const remapped = cells.map((c, index) => {
            return {
                id: `NotebookImport#${index}`,
                file: Identifiers.EmptyFileName,
                line: 0,
                state: CellState.finished,
                data: c
            };
        });

        // Turn this into our cell list
        if (remapped.length === 0) {
            const defaultCell: ICell = {
                id: uuid(),
                line: 0,
                file: Identifiers.EmptyFileName,
                state: CellState.finished,
                data: createCodeCell()
            };
            // tslint:disable-next-line: no-any
            remapped.splice(0, 0, defaultCell as any);
            forceDirty = true;
        }

        // Save as our visible list
        this._cells = remapped;

        // Make dirty if necessary
        if (forceDirty) {
            await this.setDirty();
        }

        // Indicate loaded
        this._loaded = true;

        return this._cells;
    }

    private async extractPythonMainVersion(notebookData: Partial<nbformat.INotebookContent>): Promise<number> {
        if (
            notebookData &&
            notebookData.metadata &&
            notebookData.metadata.language_info &&
            notebookData.metadata.language_info.codemirror_mode &&
            // tslint:disable-next-line: no-any
            typeof (notebookData.metadata.language_info.codemirror_mode as any).version === 'number'
        ) {
            // tslint:disable-next-line: no-any
            return (notebookData.metadata.language_info.codemirror_mode as any).version;
        }
        // Use the active interpreter
        const usableInterpreter = await this.jupyterExecution.getUsableJupyterPython();
        return usableInterpreter && usableInterpreter.version ? usableInterpreter.version.major : 3;
    }

    private async ensureNotebookJson(): Promise<void> {
        if (!this.notebookJson || !this.notebookJson.metadata) {
            const pythonNumber = await this.extractPythonMainVersion(this.notebookJson);
            // Use this to build our metadata object
            // Use these as the defaults unless we have been given some in the options.
            const metadata: nbformat.INotebookMetadata = {
                language_info: {
                    name: 'python',
                    codemirror_mode: {
                        name: 'ipython',
                        version: pythonNumber
                    }
                },
                orig_nbformat: 2,
                file_extension: '.py',
                mimetype: 'text/x-python',
                name: 'python',
                npconvert_exporter: 'python',
                pygments_lexer: `ipython${pythonNumber}`,
                version: pythonNumber
            };

            // Default notebook data.
            this.notebookJson = {
                nbformat: 4,
                nbformat_minor: 2,
                metadata: metadata
            };
        }
    }

    private async generateNotebookContent(cells: ICell[]): Promise<string> {
        // Make sure we have some
        await this.ensureNotebookJson();

        // Reuse our original json except for the cells.
        const json = {
            ...(this.notebookJson as nbformat.INotebookContent),
            cells: cells.map(c => this.fixupCell(c.data))
        };
        return JSON.stringify(json, null, this.indentAmount);
    }

    private fixupCell(cell: nbformat.ICell): nbformat.ICell {
        // Source is usually a single string on input. Convert back to an array
        return ({
            ...cell,
            source: splitMultilineString(cell.source)
            // tslint:disable-next-line: no-any
        } as any) as nbformat.ICell; // nyc (code coverage) barfs on this so just trick it.
    }

    private async setDirty(): Promise<void> {
        // Update dirty flag.
        if (!this._isDirty) {
            this._isDirty = true;

            // Tell listeners we're dirty
            this._changedEmitter.fire();
        }
    }

    private getStorageKey(): string {
        return `${KeyPrefix}${this._file.toString()}`;
    }

    /**
     * Gets any unsaved changes to the notebook file from the old locations.
     * If the file has been modified since the uncommitted changes were stored, then ignore the uncommitted changes.
     *
     * @private
     * @returns {(Promise<string | undefined>)}
     * @memberof NativeEditor
     */
    private async getStoredContents(): Promise<string | undefined> {
        const key = this.getStorageKey();

        // First look in the global storage file location
        let result = await this.getStoredContentsFromFile(key);
        if (!result) {
            result = await this.getStoredContentsFromGlobalStorage(key);
            if (!result) {
                result = await this.getStoredContentsFromLocalStorage(key);
            }
        }

        return result;
    }

    private async getStoredContentsFromFile(key: string): Promise<string | undefined> {
        const filePath = this.getHashedFileName(key);
        try {
            // Use this to read from the extension global location
            const contents = await this.fileSystem.readFile(filePath);
            const data = JSON.parse(contents);
            // Check whether the file has been modified since the last time the contents were saved.
            if (data && data.lastModifiedTimeMs && !this.isUntitled && this.file.scheme === 'file') {
                const stat = await this.fileSystem.stat(this.file.fsPath);
                if (stat.mtime > data.lastModifiedTimeMs) {
                    return;
                }
            }
            if (data && !this.isUntitled && data.contents) {
                return data.contents;
            }
        } catch {
            noop();
        }
    }

    private async getStoredContentsFromGlobalStorage(key: string): Promise<string | undefined> {
        try {
            const data = this.globalStorage.get<{ contents?: string; lastModifiedTimeMs?: number }>(key);

            // If we have data here, make sure we eliminate any remnants of storage
            if (data) {
                await this.transferStorage();
            }

            // Check whether the file has been modified since the last time the contents were saved.
            if (data && data.lastModifiedTimeMs && !this.isUntitled && this.file.scheme === 'file') {
                const stat = await this.fileSystem.stat(this.file.fsPath);
                if (stat.mtime > data.lastModifiedTimeMs) {
                    return;
                }
            }
            if (data && !this.isUntitled && data.contents) {
                return data.contents;
            }
        } catch {
            noop();
        }
    }

    private async getStoredContentsFromLocalStorage(key: string): Promise<string | undefined> {
        const workspaceData = this.localStorage.get<string>(key);
        if (workspaceData && !this.isUntitled) {
            // Make sure to clear so we don't use this again.
            this.localStorage.update(key, undefined);

            return workspaceData;
        }
    }

    // VS code recommended we use the hidden '_values' to iterate over all of the entries in
    // the global storage map and delete the ones we own.
    private async transferStorage(): Promise<void[]> {
        const promises: Thenable<void>[] = [];

        // Indicate we ran this function
        await this.globalStorage.update(NotebookTransferKey, true);

        try {
            // tslint:disable-next-line: no-any
            if ((this.globalStorage as any)._value) {
                // tslint:disable-next-line: no-any
                const keys = Object.keys((this.globalStorage as any)._value);
                [...keys].forEach((k: string) => {
                    if (k.startsWith(KeyPrefix)) {
                        // Remove from the map so that global storage does not have this anymore.
                        // Use the real API here as we don't know how the map really gets updated.
                        promises.push(this.globalStorage.update(k, undefined));
                    }
                });
            }
        } catch (e) {
            traceError('Exception eliminating global storage parts:', e);
        }

        return Promise.all(promises);
    }

    private getHashedFileName(key: string): string {
        const file = `${this.crypto.createHash(key, 'string')}.ipynb`;
        return path.join(this.context.globalStoragePath, file);
    }
}
