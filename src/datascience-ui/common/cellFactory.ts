// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import '../../client/common/extensions';
import { nbformat } from '@jupyterlab/coreutils';
import cloneDeep = require('lodash/cloneDeep');
import { generateMarkdownFromCodeLines, appendLineFeed } from './index';

function uncommentMagicCommands(line: string): string {
    // Uncomment lines that are shell assignments (starting with #!),
    // line magic (starting with #!%) or cell magic (starting with #!%%).
    if (/^#\s*!/.test(line)) {
        // If the regex test passes, it's either line or cell magic.
        // Hence, remove the leading # and ! including possible white space.
        if (/^#\s*!\s*%%?/.test(line)) {
            return line.replace(/^#\s*!\s*/, '');
        }
        // If the test didn't pass, it's a shell assignment. In this case, only
        // remove leading # including possible white space.
        return line.replace(/^#\s*/, '');
    } else {
        // If it's regular Python code, just return it.
        return line;
    }
}

export function createMarkdownCell(code: string | string[]): nbformat.IMarkdownCell {
    code = Array.isArray(code) ? code : [code];
    return {
        cell_type: 'markdown',
        metadata: {},
        source: generateMarkdownFromCodeLines(code)
    };
}

export function createErrorOutput(error: Error): nbformat.IError {
    return {
        output_type: 'error',
        ename: error.name,
        evalue: error.message,
        traceback: (error.stack || '').splitLines()
    };
}
export function createCodeCell(): nbformat.ICodeCell;
export function createCodeCell(code: string): nbformat.ICodeCell;
export function createCodeCell(code: string[], outputs: nbformat.IOutput[]): nbformat.ICodeCell;
export function createCodeCell(code: string[], magicCommandsAsComments: boolean): nbformat.ICodeCell;
export function createCodeCell(code?: string | string[], options?: boolean | nbformat.IOutput[]): nbformat.ICodeCell {
    const magicCommandsAsComments = typeof options === 'boolean' ? options : false;
    const outputs = typeof options === 'boolean' ? [] : options || [];
    code = code || '';
    code = Array.isArray(code) ? code : [code];
    return {
        source: appendLineFeed(code, magicCommandsAsComments ? uncommentMagicCommands : undefined),
        cell_type: 'code',
        outputs,
        metadata: {},
        execution_count: null
    };
}
/**
 * Clones a cell.
 * Also dumps unrecognized attributes from cells.
 *
 * @export
 * @template T
 * @param {T} cell
 * @returns {T}
 */
export function cloneCell<T extends nbformat.IBaseCell>(cell: T): T {
    // Construct the cell by hand so we drop unwanted/unrecognized properties from cells.
    // This way, the cell contains only the attributes that are valid (supported type).
    const clonedCell = cloneDeep(cell);
    const source = Array.isArray(cell.source) || typeof cell.source === 'string' ? cell.source : '';
    switch (cell.cell_type) {
        case 'code': {
            const codeCell: nbformat.ICodeCell = {
                cell_type: 'code',
                metadata: clonedCell.metadata ?? {},
                execution_count: typeof cell.execution_count === 'number' ? cell.execution_count : null,
                outputs: Array.isArray(cell.outputs) ? (cell.outputs as nbformat.IOutput[]) : [],
                source
            };
            return (codeCell as any) as T;
        }
        case 'markdown': {
            const markdownCell: nbformat.IMarkdownCell = {
                cell_type: 'markdown',
                metadata: clonedCell.metadata ?? {},
                source,
                attachments: clonedCell.attachments as any
            };
            return (markdownCell as any) as T;
        }
        case 'raw': {
            const rawCell: nbformat.IRawCell = {
                cell_type: 'raw',
                metadata: clonedCell.metadata ?? {},
                source,
                attachments: clonedCell.attachments as any
            };
            return (rawCell as any) as T;
        }
        default: {
            // Possibly one of our cell types (`message`).
            return clonedCell;
        }
    }
}

export function createCellFrom(source: nbformat.IBaseCell, target: nbformat.CellType): nbformat.ICodeCell | nbformat.IMarkdownCell | nbformat.IRawCell {
    // If we're creating a new cell from the same base type, then ensure we preserve the metadata.
    const baseCell: nbformat.IBaseCell =
        source.cell_type === target
            ? (cloneCell(source) as any)
            : {
                  source: source.source,
                  cell_type: target,
                  metadata: JSON.parse(JSON.stringify(source.metadata))
              };

    switch (target) {
        case 'code': {
            const codeCell: nbformat.ICodeCell = {
                ...baseCell,
                cell_type: 'code',
                execution_count: null,
                outputs: []
            };
            return codeCell;
        }
        case 'markdown': {
            const markdownCell: nbformat.IMarkdownCell = {
                ...baseCell,
                cell_type: 'markdown'
            };
            return markdownCell;
        }
        case 'raw': {
            const rawCell: nbformat.IRawCell = {
                ...baseCell,
                cell_type: 'raw'
            };
            return rawCell;
        }
        default: {
            throw new Error(`Unsupported target type, ${target}`);
        }
    }
}
