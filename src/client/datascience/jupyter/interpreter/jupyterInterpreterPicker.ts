// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { QuickPickOptions } from 'vscode';
import { IApplicationShell, IWorkspaceService } from '../../../common/application/types';
import { IConfigurationService, IPathUtils, Resource } from '../../../common/types';
import { IInterpreterSelector } from '../../../interpreter/configuration/types';
import { PythonInterpreter } from '../../../interpreter/contracts';

@injectable()
export class JupyterInterpreterPicker {
    constructor(
        @inject(IInterpreterSelector) private readonly interpreterSelector: IInterpreterSelector,
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IPathUtils) private readonly pathUtils: IPathUtils
    ) {}
    public async selectInterpreter(resource: Resource): Promise<PythonInterpreter | undefined> {
        const currentJupyterInterpreter = this.configService.getSettings(resource).datascience.jupyterInterpreter;
        const workspace = this.workspace.getWorkspaceFolder(resource);
        const currentPythonPath = currentJupyterInterpreter ? this.pathUtils.getDisplayName(currentJupyterInterpreter, workspace?.uri.fsPath) : undefined;

        const suggestions = await this.interpreterSelector.getSuggestions(resource);
        const quickPickOptions: QuickPickOptions = {
            matchOnDetail: true,
            matchOnDescription: true,
            placeHolder: currentPythonPath ? `current: ${currentPythonPath}` : ''
        };

        const selection = await this.applicationShell.showQuickPick(suggestions, quickPickOptions);
        if (!selection) {
            return;
        }
        return selection.interpreter;
    }
}
