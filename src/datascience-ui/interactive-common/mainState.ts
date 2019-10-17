// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { nbformat } from '@jupyterlab/coreutils';
// tslint:disable-next-line: no-require-imports
import cloneDeep = require('lodash/cloneDeep');
import * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
import * as path from 'path';

import { IDataScienceSettings } from '../../client/common/types';
import { CellMatcher } from '../../client/datascience/cellMatcher';
import { concatMultilineStringInput, splitMultilineString } from '../../client/datascience/common';
import { Identifiers } from '../../client/datascience/constants';
import { CellState, ICell, IJupyterVariable, IMessageCell } from '../../client/datascience/types';
import { noop } from '../../test/core';
import { InputHistory } from './inputHistory';

export interface ICellViewModel {
    cell: ICell;
    inputBlockShow: boolean;
    inputBlockOpen: boolean;
    inputBlockText: string;
    inputBlockCollapseNeeded: boolean;
    editable: boolean;
    directInput?: boolean;
    showLineNumbers?: boolean;
    hideOutput?: boolean;
    useQuickEdit?: boolean;
    selected: boolean;
    focused: boolean;
    inputBlockToggled(id: string): void;
}

export interface IMainState {
    cellVMs: ICellViewModel[];
    editCellVM: ICellViewModel | undefined;
    busy: boolean;
    skipNextScroll?: boolean;
    undoStack: ICellViewModel[][];
    redoStack: ICellViewModel[][];
    submittedText: boolean;
    history: InputHistory;
    rootStyle?: string;
    rootCss?: string;
    font: IFont;
    theme?: string;
    forceDark?: boolean;
    monacoTheme?: string;
    tokenizerLoaded?: boolean;
    knownDark: boolean;
    editorOptions?: monacoEditor.editor.IEditorOptions;
    currentExecutionCount: number;
    variablesVisible: boolean;
    variables: IJupyterVariable[];
    pendingVariableCount: number;
    debugging: boolean;
    dirty?: boolean;
    selectedCellId?: string;
    focusedCellId?: string;
    enableGather: boolean;
    isAtBottom: boolean;
    newCellId?: string;
    loadTotal?: number;
}

export interface IFont {
    size: number;
    family: string;
}

export const testState = {
    generateTestState: (_inputBlockToggled: (id: string) => void, _filePath: string, _editable: boolean): IMainState => {
        // tslint:disable-next-line: no-any
        return undefined as any;
    }
};
export function generateTestState(inputBlockToggled: (id: string) => void, filePath: string = '', editable: boolean = false): IMainState {
    return testState.generateTestState(inputBlockToggled, filePath, editable);
}
