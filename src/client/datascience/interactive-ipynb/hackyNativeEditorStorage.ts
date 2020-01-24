import { nbformat } from '@jupyterlab/coreutils';
import * as path from 'path';
import * as uuid from 'uuid/v4';
import { Event, EventEmitter, Memento, Uri } from 'vscode';
import { concatMultilineStringInput, splitMultilineString } from '../../../datascience-ui/common';
import { createCodeCell } from '../../../datascience-ui/common/cellFactory';
import { IApplicationShell, IWorkspaceService } from '../../common/application/types';
import { traceError } from '../../common/logger';
import { IFileSystem } from '../../common/platform/types';
import { ICryptoUtils, IExtensionContext } from '../../common/types';
import * as localize from '../../common/utils/localize';
import { noop } from '../../common/utils/misc';
import { PythonInterpreter } from '../../interpreter/contracts';
import { captureTelemetry } from '../../telemetry';
import { Identifiers, Telemetry } from '../constants';
import { IEditCell, IInsertCell, IRemoveCell, ISwapCells } from '../interactive-common/interactiveWindowTypes';
import { InvalidNotebookFileError } from '../jupyter/invalidNotebookFileError';
import { LiveKernelModel } from '../jupyter/kernels/types';
import { CellState, ICell, IJupyterExecution, IJupyterKernelSpec, INotebookEditorProvider, INotebookStorage } from '../types';

// tslint:disable-next-line:no-require-imports no-var-requires
const debounce = require('lodash/debounce') as typeof import('lodash/debounce');

// tslint:disable-next-line:no-require-imports no-var-requires
import detectIndent = require('detect-indent');

enum AskForSaveResult {
    Yes,
    No,
    Cancel
}

const KeyPrefix = 'notebook-storage-';
const NotebookTransferKey = 'notebook-transfered';
export class HackyNativeEditorStorage implements INotebookStorage {
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
    private _changedEmitter = new EventEmitter<void>();
    private _cells: ICell[] = [];
    private _loadPromise: Promise<ICell[]> | undefined;
    private _loaded = false;
    private _file: Uri;
    private _isDirty: boolean = false;
    private indentAmount: string = ' ';
    private notebookJson: Partial<nbformat.INotebookContent> = {};
    private isPromptingToSaveToDisc = false;
    private debouncedWriteToStorage = debounce(this.writeToStorage.bind(this), 250);

    constructor(
        file: Uri,
        private initialContents: string,
        private workspaceService: IWorkspaceService,
        private jupyterExecution: IJupyterExecution,
        private fileSystem: IFileSystem,
        private crypto: ICryptoUtils,
        private context: IExtensionContext,
        private applicationShell: IApplicationShell,
        private provider: INotebookEditorProvider,
        private globalStorage: Memento,
        private localStorage: Memento
    ) {
        this._file = file;
    }
    public getCells(): Promise<ICell[]> {
        if (!this._loadPromise) {
            this._loadPromise = this.load();
        }
        if (!this._loaded) {
            return this._loadPromise;
        }

        // If already loaded, return the updated cell values
        return Promise.resolve(this._cells);
    }

    public async getJson(): Promise<Partial<nbformat.INotebookContent>> {
        await this.ensureNotebookJson();
        return this.notebookJson;
    }

    public async handleEdit(request: IEditCell): Promise<void> {
        // Apply the changes to the visible cell list. We won't get an update until
        // submission otherwise
        if (request.changes && request.changes.length) {
            const change = request.changes[0];
            const normalized = change.text.replace(/\r/g, '');

            // Figure out which cell we're editing.
            const cell = this._cells.find(c => c.id === request.id);
            if (cell) {
                // This is an actual edit.
                const contents = concatMultilineStringInput(cell.data.source);
                const before = contents.substr(0, change.rangeOffset);
                const after = contents.substr(change.rangeOffset + change.rangeLength);
                const newContents = `${before}${normalized}${after}`;
                if (contents !== newContents) {
                    cell.data.source = newContents;
                    return this.setDirty();
                }
            }
        }
    }

    public async handleInsert(request: IInsertCell): Promise<void> {
        // Insert a cell into our visible list based on the index. They should be in sync
        this._cells.splice(request.index, 0, request.cell);
        return this.setDirty();
    }

    public async handleRemoveCell(request: IRemoveCell): Promise<void> {
        // Filter our list
        this._cells = this._cells.filter(v => v.id !== request.id);
        return this.setDirty();
    }

    public async handleSwapCells(request: ISwapCells): Promise<void> {
        // Swap two cells in our list
        const first = this._cells.findIndex(v => v.id === request.firstCellId);
        const second = this._cells.findIndex(v => v.id === request.secondCellId);
        if (first >= 0 && second >= 0) {
            const temp = { ...this._cells[first] };
            this._cells[first] = this._cells[second];
            this._cells[second] = temp;
            return this.setDirty();
        }
    }

    public async handleDeleteAllCells(): Promise<void> {
        this._cells = [];
        return this.setDirty();
    }

    public async handleModifyCells(cells: ICell[]): Promise<void> {
        // Update these cells in our list
        cells.forEach(c => {
            const index = this._cells.findIndex(v => v.id === c.id);
            this._cells[index] = c;
        });

        // Indicate dirty
        return this.setDirty();
    }

    public async handleSaveAs(newFile: Uri, cells: ICell[]): Promise<void> {
        return this.fileSystem.writeFile(newFile.fsPath, await this.generateNotebookContent(cells), { encoding: 'utf-8' });
    }

    public async handleClose(): Promise<void> {
        // Ask user if they want to save. It seems hotExit has no bearing on
        // whether or not we should ask
        if (this.isDirty) {
            const askResult = await this.askForSave();
            switch (askResult) {
                case AskForSaveResult.Yes:
                    // Save the file
                    await this.saveToDisk();
                    break;

                case AskForSaveResult.No:
                    // Mark as not dirty, so we update our storage
                    await this.setClean();
                    break;

                default:
                    // Reopen
                    await this.provider.open(this.file, await this.generateNotebookContent(this._cells));
                    break;
            }
        }
    }

    public async handleUpdateVersionInfo(interpreter: PythonInterpreter | undefined, kernelSpec: IJupyterKernelSpec | LiveKernelModel | undefined): Promise<void> {
        // Get our kernel_info and language_info from the current notebook
        if (interpreter && interpreter.version && this.notebookJson.metadata && this.notebookJson.metadata.language_info) {
            this.notebookJson.metadata.language_info.version = interpreter.version.raw;
        }

        if (kernelSpec && this.notebookJson.metadata && !this.notebookJson.metadata.kernelspec) {
            // Add a new spec in this case
            this.notebookJson.metadata.kernelspec = {
                name: kernelSpec.name || kernelSpec.display_name || '',
                display_name: kernelSpec.display_name || kernelSpec.name || ''
            };
        } else if (kernelSpec && this.notebookJson.metadata && this.notebookJson.metadata.kernelspec) {
            // Spec exists, just update name and display_name
            this.notebookJson.metadata.kernelspec.name = kernelSpec.name || kernelSpec.display_name || '';
            this.notebookJson.metadata.kernelspec.display_name = kernelSpec.display_name || kernelSpec.name || '';
        }
    }
    private async load(): Promise<ICell[]> {
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
            return this.loadContents(this.initialContents, false);
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
        // Update storage if not untitled. Don't wait for results.
        if (!this.isUntitled) {
            this.generateNotebookContent(this._cells)
                .then(c => this.storeContents(c).catch(ex => traceError('Failed to generate notebook content to store in state', ex)))
                .ignoreErrors();
        }

        // Then update dirty flag.
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
     * Gets any unsaved changes to the notebook file.
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

            // Transfer this to a file so we use that next time instead.
            const filePath = this.getHashedFileName(key);
            await this.writeToStorage(filePath, workspaceData);

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
                        // Write each pair to our alternate storage, but don't bother waiting for each
                        // to finish.
                        const filePath = this.getHashedFileName(k);
                        const contents = this.globalStorage.get(k);
                        if (contents) {
                            this.writeToStorage(filePath, JSON.stringify(contents)).ignoreErrors();
                        }

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

    /**
     * Stores the uncommitted notebook changes into a temporary location.
     * Also keep track of the current time. This way we can check whether changes were
     * made to the file since the last time uncommitted changes were stored.
     *
     * @private
     * @param {string} [contents]
     * @returns {Promise<void>}
     * @memberof NativeEditor
     */
    private async storeContents(contents?: string): Promise<void> {
        // Skip doing this if auto save is enabled.
        const filesConfig = this.workspaceService.getConfiguration('files', this.file);
        const autoSave = filesConfig.get('autoSave', 'off');
        if (autoSave === 'off') {
            const key = this.getStorageKey();
            const filePath = this.getHashedFileName(key);

            // Keep track of the time when this data was saved.
            // This way when we retrieve the data we can compare it against last modified date of the file.
            const specialContents = contents ? JSON.stringify({ contents, lastModifiedTimeMs: Date.now() }) : undefined;

            // Write but debounced (wait at least 250 ms)
            return this.debouncedWriteToStorage(filePath, specialContents);
        }
    }

    private async writeToStorage(filePath: string, contents?: string): Promise<void> {
        try {
            if (contents) {
                await this.fileSystem.createDirectory(path.dirname(filePath));
                return this.fileSystem.writeFile(filePath, contents);
            } else {
                return this.fileSystem.deleteFile(filePath);
            }
        } catch (exc) {
            traceError(`Error writing storage for ${filePath}: `, exc);
        }
    }

    private getHashedFileName(key: string): string {
        const file = `${this.crypto.createHash(key, 'string')}.ipynb`;
        return path.join(this.context.globalStoragePath, file);
    }

    private async setClean(): Promise<void> {
        // Always update storage
        this.storeContents(undefined).catch(ex => traceError('Failed to clear notebook store', ex));

        if (this._isDirty) {
            this._isDirty = false;
            this._changedEmitter.fire();
        }
    }

    private async askForSave(): Promise<AskForSaveResult> {
        const message1 = localize.DataScience.dirtyNotebookMessage1().format(`${path.basename(this.file.fsPath)}`);
        const message2 = localize.DataScience.dirtyNotebookMessage2();
        const yes = localize.DataScience.dirtyNotebookYes();
        const no = localize.DataScience.dirtyNotebookNo();
        // tslint:disable-next-line: messages-must-be-localized
        const result = await this.applicationShell.showInformationMessage(`${message1}\n${message2}`, { modal: true }, yes, no);
        switch (result) {
            case yes:
                return AskForSaveResult.Yes;

            case no:
                return AskForSaveResult.No;

            default:
                return AskForSaveResult.Cancel;
        }
    }

    @captureTelemetry(Telemetry.Save, undefined, true)
    private async saveToDisk(): Promise<void> {
        // If we're already in the middle of prompting the user to save, then get out of here.
        // We could add a debounce decorator, unfortunately that slows saving (by waiting for no more save events to get sent).
        if (this.isPromptingToSaveToDisc && this.isUntitled) {
            return;
        }
        try {
            let fileToSaveTo: Uri | undefined = this.file;
            let isDirty = this._isDirty;

            // Ask user for a save as dialog if no title
            if (this.isUntitled) {
                this.isPromptingToSaveToDisc = true;
                const filtersKey = localize.DataScience.dirtyNotebookDialogFilter();
                const filtersObject: { [name: string]: string[] } = {};
                filtersObject[filtersKey] = ['ipynb'];
                isDirty = true;

                fileToSaveTo = await this.applicationShell.showSaveDialog({
                    saveLabel: localize.DataScience.dirtyNotebookDialogTitle(),
                    filters: filtersObject
                });
            }

            if (fileToSaveTo && isDirty) {
                // Write out our visible cells
                await this.fileSystem.writeFile(fileToSaveTo.fsPath, await this.generateNotebookContent(this._cells));

                // Update our file name and dirty state
                this._file = fileToSaveTo;
                await this.setClean();
            }
        } catch (e) {
            traceError(e);
        } finally {
            this.isPromptingToSaveToDisc = false;
        }
    }
}
