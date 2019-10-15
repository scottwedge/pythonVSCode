// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { nbformat } from '@jupyterlab/coreutils';
import { inject, injectable } from 'inversify';
import * as os from 'os';
import * as path from 'path';
import * as uuid from 'uuid/v4';

import { IWorkspaceService } from '../../../common/application/types';
import { IFileSystem, IPlatformService } from '../../../common/platform/types';
import * as localize from '../../../common/utils/localize';
import { noop } from '../../../common/utils/misc';
import { concatMultilineString, splitMultilineString } from '../../common';
import { CodeSnippits, Identifiers } from '../../constants';
import { CellState, ICell, NotebookExportOptions } from '../../types';

@injectable()
export class NotebookConverter {
    constructor(
        @inject(IWorkspaceService) private workspaceService: IWorkspaceService,
        @inject(IFileSystem) private fileSystem: IFileSystem,
        @inject(IPlatformService) private readonly platform: IPlatformService
    ) {}

    public dispose() {
        noop();
    }

    public async convert(cells: ICell[], options: NotebookExportOptions): Promise<nbformat.INotebookContent> {
        // If requested, add in a change directory cell to fix relative paths
        if (options.directoryChange) {
            cells = await this.addDirectoryChangeCell(cells, options.directoryChange);
        }

        // Use this to build our metadata object
        // tslint:disable-next-line: no-any
        const notebookData: nbformat.INotebookContent = options.notebookJson || {} as any;

        // Combine this into a JSON object
        return {
            ...notebookData,
            cells: cells.map(c => this.fixupCell(c.data))
        };
    }
    private fixupCell(cell: nbformat.ICell): nbformat.ICell {
        // Source is usually a single string on input. Convert back to an array
        return {
            ...cell,
            source: splitMultilineString(cell.source)
        };
    }

    // For exporting, put in a cell that will change the working directory back to the workspace directory so relative data paths will load correctly
    private addDirectoryChangeCell = async (cells: ICell[], file: string): Promise<ICell[]> => {
        const changeDirectory = await this.calculateDirectoryChange(file, cells);

        if (changeDirectory) {
            const exportChangeDirectory = CodeSnippits.ChangeDirectory.join(os.EOL).format(
                localize.DataScience.exportChangeDirectoryComment(),
                CodeSnippits.ChangeDirectoryCommentIdentifier,
                changeDirectory
            );

            const cell: ICell = {
                data: {
                    source: exportChangeDirectory,
                    cell_type: 'code',
                    outputs: [],
                    metadata: {},
                    execution_count: 0
                },
                id: uuid(),
                file: Identifiers.EmptyFileName,
                line: 0,
                state: CellState.finished,
                type: 'execute'
            };

            return [cell, ...cells];
        } else {
            return cells;
        }
    }

    // When we export we want to our change directory back to the first real file that we saw run from any workspace folder
    private firstWorkspaceFolder = async (cells: ICell[]): Promise<string | undefined> => {
        for (const cell of cells) {
            const filename = cell.file;

            // First check that this is an absolute file that exists (we add in temp files to run system cell)
            if (path.isAbsolute(filename) && (await this.fileSystem.fileExists(filename))) {
                // We've already check that workspace folders above
                for (const folder of this.workspaceService.workspaceFolders!) {
                    if (filename.toLowerCase().startsWith(folder.uri.fsPath.toLowerCase())) {
                        return folder.uri.fsPath;
                    }
                }
            }
        }

        return undefined;
    }

    private calculateDirectoryChange = async (notebookFile: string, cells: ICell[]): Promise<string | undefined> => {
        // Make sure we don't already have a cell with a ChangeDirectory comment in it.
        let directoryChange: string | undefined;
        const haveChangeAlready = cells.find(c => concatMultilineString(c.data.source).includes(CodeSnippits.ChangeDirectoryCommentIdentifier));
        if (!haveChangeAlready) {
            const notebookFilePath = path.dirname(notebookFile);
            // First see if we have a workspace open, this only works if we have a workspace root to be relative to
            if (this.workspaceService.hasWorkspaceFolders) {
                const workspacePath = await this.firstWorkspaceFolder(cells);

                // Make sure that we have everything that we need here
                if (workspacePath && path.isAbsolute(workspacePath) && notebookFilePath && path.isAbsolute(notebookFilePath)) {
                    directoryChange = path.relative(notebookFilePath, workspacePath);
                }
            }
        }

        // If path.relative can't calculate a relative path, then it just returns the full second path
        // so check here, we only want this if we were able to calculate a relative path, no network shares or drives
        if (directoryChange && !path.isAbsolute(directoryChange)) {
            // Escape windows path chars so they end up in the source escaped
            if (this.platform.isWindows) {
                directoryChange = directoryChange.replace('\\', '\\\\');
            }

            return directoryChange;
        } else {
            return undefined;
        }
    }
}
