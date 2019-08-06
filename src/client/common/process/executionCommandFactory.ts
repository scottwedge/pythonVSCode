// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

export interface ICommandExecutionFactory {
    create(executable: string, args: string[]): Promise<{ command: string; args: string[] }>;
}

export class AbstractFactory implements ICommandExecutionFactory {
    constructor()
}
