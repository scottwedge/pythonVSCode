// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { JSONObject } from '@phosphor/coreutils';
import { inject, injectable } from 'inversify';
import { noop } from '../../../../test/core';
import { IFileSystem, TemporaryFile } from '../../../common/platform/types';
import { ICell, INotebookExporter, NotebookExportOptions } from '../../types';
import { NotebookConverter } from './notebookConverter';
import { PythonConverter } from './pythonConverter';

@injectable()
export class JupyterExporter implements INotebookExporter {
    constructor(
        @inject(PythonConverter) private readonly pythonConverter: PythonConverter,
        @inject(NotebookConverter) private readonly notebookConverter: NotebookConverter,
        @inject(IFileSystem) private readonly fileSystem: IFileSystem
    ) {}
    public dispose() {
        noop();
    }
    public export(format: 'notebook', cells: ICell[], _options: NotebookExportOptions): Promise<JSONObject>;
    public export(format: 'python', cells: ICell[], _options: NotebookExportOptions): Promise<string>;
    // tslint:disable-next-line: no-any
    public export(format: any, cells: any, options: NotebookExportOptions): Promise<any> {
        switch (format) {
            case 'python':
                return this.exportToPython(cells, options);
            case 'notebook':
                return this.notebookConverter.convert(cells, options.directoryChange);
            default:
                throw new Error(`Exporting cells to '${format}' format not supported!`);
        }
    }
    public async save(format: 'notebook' | 'python', cells: ICell[], options: NotebookExportOptions & { filePath: string }): Promise<void> {
        switch (format) {
            case 'python': {
                const code = await this.exportToPython(cells, options);
                return this.fileSystem.writeFile(options.filePath, code, { encoding: 'utf8' });
            }
            case 'notebook': {
                const data = await this.notebookConverter.convert(cells, options.directoryChange);
                const notebook = JSON.stringify(data, undefined, 2);
                return this.fileSystem.writeFile(options.filePath, notebook, { encoding: 'utf8' });
            }
            default:
                throw new Error(`Exporting cells to '${format}' format not supported!`);
        }
    }
    /**
     * The python converter needs a notebook file.
     * Hence first convert the cells into a notebook file, then convert that into a python file.
     *
     * @private
     * @param {ICell[]} cells
     * @param {NotebookExportOptions} options
     * @returns {Promise<string>}
     * @memberof JupyterExporter
     */
    private async exportToPython(cells: ICell[], options: NotebookExportOptions): Promise<string> {
        // First generate a temporary notebook with these cells.
        let tempFile: TemporaryFile | undefined;
        try {
            tempFile = await this.fileSystem.createTemporaryFile('.ipynb');
            await this.save('notebook', cells, { ...options, filePath: tempFile.filePath });
            return this.pythonConverter.convert(tempFile.filePath);
        } finally {
            if (tempFile) {
                tempFile.dispose();
            }
        }
    }
}
