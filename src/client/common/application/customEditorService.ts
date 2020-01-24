// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { injectable } from 'inversify';
import * as vscode from 'vscode';

import { ICustomEditorService } from './types';

@injectable()
export class CustomEditorService implements ICustomEditorService {
    public get supportsCustomEditors(): boolean {
        return vscode.window.registerWebviewCustomEditorProvider !== undefined;
    }

    public registerWebviewCustomEditorProvider(viewType: string, provider: vscode.WebviewCustomEditorProvider, options?: vscode.WebviewPanelOptions): vscode.Disposable {
        return vscode.window.registerWebviewCustomEditorProvider(viewType, provider, options);
    }
}
