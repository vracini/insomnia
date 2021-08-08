import 'swagger-ui-react/swagger-ui.css';

import { autoBindMethodsForReact } from 'class-autobind-decorator';
import {
  Breadcrumb,
  Button,
  CardContainer,
  Dropdown,
  DropdownDivider,
  DropdownItem,
  Header,
} from 'insomnia-components';
import React, { Fragment, PureComponent } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { unreachableCase } from 'ts-assert-unreachable';

import { parseApiSpec, ParsedApiSpec } from '../../common/api-specs';
import {
  AUTOBIND_CFG,
  SpaceSortOrder,
} from '../../common/constants';
import { hotKeyRefs } from '../../common/hotkeys';
import { executeHotKey } from '../../common/hotkeys-listener';
import { isNotNullOrUndefined } from '../../common/misc';
import { descendingNumberSort, sortMethodMap } from '../../common/sorting';
import { strings } from '../../common/strings';
import { ApiSpec } from '../../models/api-spec';
import { isRemoteSpace } from '../../models/space';
import { isDesign, Workspace, WorkspaceScopeKeys } from '../../models/workspace';
import { WorkspaceMeta } from '../../models/workspace-meta';
import { MemClient } from '../../sync/git/mem-client';
import { initializeLocalProjectAndMarkForSync } from '../../sync/vcs/initialize-project';
import coreLogo from '../images/insomnia-core-logo.png';
import { cloneGitRepository } from '../redux/modules/git';
import { setSpaceSortOrder } from '../redux/modules/global';
import { ForceToWorkspace } from '../redux/modules/helpers';
import { importClipBoard, importFile, importUri } from '../redux/modules/import';
import { activateWorkspace, createWorkspace } from '../redux/modules/workspace';
import { selectSpaceSortOrder } from '../redux/selectors';
import SettingsButton from './buttons/settings-button';
import AccountDropdown from './dropdowns/account-dropdown';
import { RemoteWorkspacesDropdown } from './dropdowns/remote-workspaces-dropdown';
import { SpaceDropdown } from './dropdowns/space-dropdown';
import { SpaceSortDropdown } from './dropdowns/space-sort-dropdown';
import KeydownBinder from './keydown-binder';
import { showPrompt } from './modals';
import Notice from './notice';
import PageLayout from './page-layout';
import WorkspaceCard, { WorkspaceCardProps } from './workspace-card';
import type { WrapperProps } from './wrapper';

interface Props
  extends ReturnType<typeof mapDispatchToProps>,
    ReturnType<typeof mapStateToProps> {
  wrapperProps: WrapperProps;
}

interface State {
  filter: string;
}

function orderSpaceCards(orderBy: SpaceSortOrder) {
  return (cardA: Pick<WorkspaceCardProps, 'workspace' | 'lastModifiedTimestamp'>, cardB: Pick<WorkspaceCardProps, 'workspace' | 'lastModifiedTimestamp'>) => {
    switch (orderBy) {
      case 'modified-desc':
        return sortMethodMap['modified-desc'](cardA, cardB);
      case 'name-asc':
        return sortMethodMap['name-asc'](cardA.workspace, cardB.workspace);
      case 'name-desc':
        return sortMethodMap['name-desc'](cardA.workspace, cardB.workspace);
      case 'created-asc':
        return sortMethodMap['created-asc'](cardA.workspace, cardB.workspace);
      case 'created-desc':
        return sortMethodMap['created-desc'](cardA.workspace, cardB.workspace);
      default:
        return unreachableCase(orderBy, `Space Ordering "${orderBy}" is invalid`);
    }
  };
}

const mapWorkspaceToWorkspaceCard = ({
  apiSpecs,
  workspaceMetas,
}: {
  apiSpecs: ApiSpec[];
  workspaceMetas: WorkspaceMeta[];
}) => (workspace: Workspace) => {
  const apiSpec = apiSpecs.find(s => s.parentId === workspace._id);

  // an apiSpec model will always exist because a migration in the workspace forces it to
  if (!apiSpec) {
    return null;
  }

  let spec: ParsedApiSpec['contents'] = null;
  let specFormat: ParsedApiSpec['format'] = null;
  let specFormatVersion: ParsedApiSpec['formatVersion'] = null;

  try {
    const result = parseApiSpec(apiSpec.contents);
    spec = result.contents;
    specFormat = result.format;
    specFormatVersion = result.formatVersion;
  } catch (err) {
    // Assume there is no spec
    // TODO: Check for parse errors if it's an invalid spec
  }

  // Get cached branch from WorkspaceMeta
  const workspaceMeta = workspaceMetas?.find(
    wm => wm.parentId === workspace._id
  );

  const lastActiveBranch = workspaceMeta?.cachedGitRepositoryBranch;

  const lastCommitAuthor = workspaceMeta?.cachedGitLastAuthor;

  // WorkspaceMeta is a good proxy for last modified time
  const workspaceModified = workspaceMeta?.modified || workspace.modified;

  const modifiedLocally = isDesign(workspace)
    ? apiSpec.modified
    : workspaceModified;

  // Span spec, workspace and sync related timestamps for card last modified label and sort order
  const lastModifiedFrom = [
    workspace?.modified,
    workspaceMeta?.modified,
    apiSpec.modified,
    workspaceMeta?.cachedGitLastCommitTime,
  ];

  const lastModifiedTimestamp = lastModifiedFrom
    .filter(isNotNullOrUndefined)
    .sort(descendingNumberSort)[0];

  const hasUnsavedChanges = Boolean(
    isDesign(workspace) && workspaceMeta?.cachedGitLastCommitTime && apiSpec.modified > workspaceMeta?.cachedGitLastCommitTime
  );

  return {
    hasUnsavedChanges,
    lastModifiedTimestamp,
    modifiedLocally,
    lastCommitTime: workspaceMeta?.cachedGitLastCommitTime,
    lastCommitAuthor,
    lastActiveBranch,
    spec,
    specFormat,
    apiSpec,
    specFormatVersion,
    workspace,
  };
};

@autoBindMethodsForReact(AUTOBIND_CFG)
class WrapperHome extends PureComponent<Props, State> {
  state: State = {
    filter: '',
  };

  _filterInput: HTMLInputElement | null = null;

  _setFilterInputRef(n: HTMLInputElement) {
    this._filterInput = n;
  }

  _handleFilterChange(e: React.SyntheticEvent<HTMLInputElement>) {
    this.setState({
      filter: e.currentTarget.value,
    });
  }

  _handleDocumentCreate() {
    this.props.handleCreateWorkspace({
      scope: WorkspaceScopeKeys.design,
    });
  }

  _handleCollectionCreate() {
    const {
      handleCreateWorkspace,
      wrapperProps: { activeSpace, vcs, isLoggedIn },
    } = this.props;

    handleCreateWorkspace({
      scope: WorkspaceScopeKeys.collection,
      onCreate: async workspace => {
        // Don't mark for sync if not logged in at the time of creation
        if (isLoggedIn && vcs && isRemoteSpace(activeSpace)) {
          await initializeLocalProjectAndMarkForSync({ vcs: vcs.newInstance(), workspace });
        }
      },
    });
  }

  _handleImportFile() {
    this.props.handleImportFile({
      forceToWorkspace: ForceToWorkspace.new,
    });
  }

  _handleImportClipBoard() {
    this.props.handleImportClipboard({
      forceToWorkspace: ForceToWorkspace.new,
    });
  }

  _handleImportUri() {
    showPrompt({
      title: 'Import document from URL',
      submitName: 'Fetch and Import',
      label: 'URL',
      placeholder: 'https://website.com/insomnia-import.json',
      onComplete: uri => {
        this.props.handleImportUri(uri, {
          forceToWorkspace: ForceToWorkspace.new,
        });
      },
    });
  }

  _handleWorkspaceClone() {
    this.props.handleGitCloneWorkspace({
      createFsClient: MemClient.createClient,
    });
  }

  _handleKeyDown(e) {
    executeHotKey(e, hotKeyRefs.FILTER_DOCUMENTS, () => {
      if (this._filterInput) {
        this._filterInput.focus();
      }
    });
  }

  renderCreateMenu() {
    const button = (
      <Button variant="contained" bg="surprise" className="margin-left">
        Create
        <i className="fa fa-caret-down pad-left-sm" />
      </Button>
    );
    return (
      <Dropdown renderButton={button}>
        <DropdownDivider>New</DropdownDivider>
        <DropdownItem
          icon={<i className="fa fa-file-o" />}
          onClick={this._handleDocumentCreate}
        >
          Design Document
        </DropdownItem>
        <DropdownItem
          icon={<i className="fa fa-bars" />}
          onClick={this._handleCollectionCreate}
        >
          Request Collection
        </DropdownItem>
        <DropdownDivider>Import From</DropdownDivider>
        <DropdownItem
          icon={<i className="fa fa-plus" />}
          onClick={this._handleImportFile}
        >
          File
        </DropdownItem>
        <DropdownItem
          icon={<i className="fa fa-link" />}
          onClick={this._handleImportUri}
        >
          URL
        </DropdownItem>
        <DropdownItem
          icon={<i className="fa fa-clipboard" />}
          onClick={this._handleImportClipBoard}
        >
          Clipboard
        </DropdownItem>
        <DropdownItem
          icon={<i className="fa fa-code-fork" />}
          onClick={this._handleWorkspaceClone}
        >
          Git Clone
        </DropdownItem>
      </Dropdown>
    );
  }

  renderDashboardMenu() {
    const { wrapperProps, handleSetSpaceSortOrder } = this.props;
    const { vcs } = wrapperProps;
    return (
      <div className="row row--right pad-left wide">
        <div
          className="form-control form-control--outlined no-margin"
          style={{
            maxWidth: '400px',
          }}
        >
          <KeydownBinder onKeydown={this._handleKeyDown}>
            <input
              ref={this._setFilterInputRef}
              type="text"
              placeholder="Filter..."
              onChange={this._handleFilterChange}
              className="no-margin"
            />
            <span className="fa fa-search filter-icon" />
          </KeydownBinder>
        </div>
        <SpaceSortDropdown onSelect={handleSetSpaceSortOrder} />
        <RemoteWorkspacesDropdown vcs={vcs} className="margin-left" />
        {this.renderCreateMenu()}
      </div>
    );
  }

  render() {
    const { sortOrder, wrapperProps, handleActivateWorkspace } = this.props;
    const {
      workspaces,
      isLoading,
      vcs,
      activeSpace,
      workspaceMetas,
      apiSpecs,
    } = wrapperProps;
    const { filter } = this.state;
    // Render each card, removing all the ones that don't match the filter
    const cards = workspaces
      .map(
        mapWorkspaceToWorkspaceCard({
          workspaceMetas,
          apiSpecs,
        })
      )
      .filter(isNotNullOrUndefined)
      .sort(orderSpaceCards(sortOrder))
      .map(props => (
        <WorkspaceCard
          {...props}
          key={props.apiSpec._id}
          activeSpace={activeSpace}
          onSelect={() => handleActivateWorkspace({ workspace: props.workspace })}
          filter={filter}
        />
      ));

    const countLabel =
      cards.length === 1 ? strings.document.singular : strings.document.plural;
    return (
      <PageLayout
        wrapperProps={this.props.wrapperProps}
        renderPageHeader={() => (
          <Header
            className="app-header theme--app-header"
            gridLeft={
              <Fragment>
                <img src={coreLogo} alt="Insomnia" width="24" height="24" />
                <Breadcrumb
                  crumbs={[
                    {
                      id: 'space',
                      node: <SpaceDropdown vcs={vcs || undefined} />,
                    },
                  ]}
                />
                {isLoading ? (
                  <i className="fa fa-refresh fa-spin space-left" />
                ) : null}
              </Fragment>
            }
            gridRight={
              <>
                <SettingsButton className="margin-left" />
                <AccountDropdown className="margin-left" />
              </>
            }
          />
        )}
        renderPageBody={() => (
          <div className="document-listing theme--pane layout-body">
            <div className="document-listing__body pad-bottom">
              <div className="row-spaced margin-top margin-bottom-sm">
                <h2 className="no-margin">Dashboard</h2>
                {this.renderDashboardMenu()}
              </div>
              <CardContainer>{cards}</CardContainer>
              {filter && cards.length === 0 && (
                <Notice color="subtle">
                  No documents found for <strong>{filter}</strong>
                </Notice>
              )}
            </div>
            <div className="document-listing__footer vertically-center">
              <span>
                {cards.length} {countLabel}
              </span>
            </div>
          </div>
        )}
      />
    );
  }
}

const mapStateToProps = state => ({
  sortOrder: selectSpaceSortOrder(state),
});

const mapDispatchToProps = dispatch => {
  const bound = bindActionCreators(
    {
      createWorkspace,
      cloneGitRepository,
      importFile,
      importClipBoard,
      importUri,
      setSpaceSortOrder,
      activateWorkspace,
    },
    dispatch
  );

  return ({
    handleCreateWorkspace: bound.createWorkspace,
    handleGitCloneWorkspace: bound.cloneGitRepository,
    handleImportFile: bound.importFile,
    handleImportUri: bound.importUri,
    handleImportClipboard: bound.importClipBoard,
    handleSetSpaceSortOrder: bound.setSpaceSortOrder,
    handleActivateWorkspace: bound.activateWorkspace,
  });
};

export default connect(mapStateToProps, mapDispatchToProps)(WrapperHome);
