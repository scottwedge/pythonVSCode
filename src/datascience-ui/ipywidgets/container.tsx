// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import * as React from 'react';
import { connect } from 'react-redux';
import { IStore } from '../interactive-common/redux/store';
import { PostOffice } from '../react-common/postOffice';
import { WidgetManager } from './manager';

type IProps = { postOffice: PostOffice };

function mapStateToProps(state: IStore): IProps {
    return { postOffice: state.postOffice } ;
}
// Default dispatcher (not required, but required for strictness).
function mapDispatchToProps(dispatch: Function) {
    return {dispatch};
}

class Container extends React.Component<IProps> {
    private readonly widgetManager: WidgetManager;

    constructor(props: IProps) {
        super(props);
        // Çreating a manager and registering the post office is all we need to do.
        this.widgetManager = new WidgetManager(document.getElementById('rootWidget')!);
        this.widgetManager.registerPostOffice(props.postOffice);
    }
    public render() {
        return null;
    }
    public componentWillUnmount(){
        this.widgetManager.dispose();
    }
}

export const WidgetManagerComponent = connect(mapStateToProps, mapDispatchToProps)(Container);
