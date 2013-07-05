/**
 * @license Copyright (c) 2003-2013, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.html or http://ckeditor.com/license
 */

/**
 * @fileOverview Allows block indentation.
 */

(function() {
	'use strict';

	var isListItem,
		isFirstListItemInPath;

	CKEDITOR.plugins.add( 'indentblock', {
		requires: 'indent',
		init: function( editor ) {
			var globalHelpers = CKEDITOR.plugins.indent;

			// Use global helper functions.
			isListItem = globalHelpers.isListItem;
			isFirstListItemInPath = globalHelpers.isFirstListItemInPath;

			// Register commands.
			globalHelpers.registerCommands( editor, {
				indentblock: new commandDefinition( editor, 'indentblock', true ),
				outdentblock: new commandDefinition( editor, 'outdentblock' )
			} );

			function commandDefinition( editor, name ) {
				globalHelpers.specificDefinition.apply( this, arguments );

				this.allowedContent = {
					'div h1 h2 h3 h4 h5 h6 ol p pre ul': {
						// Do not add elements, but only text-align style if element is validated by other rule.
						propertiesOnly: true,
						styles: !this.indentClasses ? 'margin-left,margin-right' : null,
						classes: this.indentClasses || null
					}
				};

				if ( this.enterBr )
					this.allowedContent.div = true;

				this.requiredContent = ( this.enterBr ? 'div' : 'p' ) +
					( this.indentClasses ?
							'(' + this.indentClasses.join( ',' ) + ')'
						:
							'{margin-left}' );

				// Indent and outdent entire list with TAB/SHIFT+TAB key. Indenting can
				// be done only when editor path is in the first child of the list.
				editor.on( 'key', function( evt ) {
					if ( editor.mode != 'wysiwyg' )
						return;

					var key = evt.data.keyCode;

					if ( evt.data.keyCode == this.indentKey && isFirstListItemInPath( editor.elementPath() ) ) {
						// Exec related global indentation command. Global
						// commands take care of bookmarks and selection,
						// so it's much easier to use them instead of
						// content-specific commands.
						editor.execCommand( this.relatedGlobal );

						// Cancel the key event so editor doesn't lose focus.
						evt.cancel();
					}
				}, this );

				this.jobs = {
					20: {
						refresh: function( editor, path ) {
							var firstBlock = path.block || path.blockLimit;

							if ( isListItem( firstBlock ) )
								firstBlock = firstBlock.getParent();

							//	- indentContext in the path or ENTER_BR
							//
							// 			Don't try to indent if the element is out of
							//		    this plugin's scope. This assertion is omitted
							//			if ENTER_BR is in use since there may be no block
							//			in the path.
							//
							if ( !this.enterBr && !this.getContext( path ) )
								return CKEDITOR.TRISTATE_DISABLED;

							else if ( this.indentClasses ) {
								//	+ indentContext in the path or ENTER_BR
								//	+ IndentClasses
								//
								// 			If there are indentation classes, check if reached
								// 		    the highest level of indentation. If so, disable
								// 		    the command.
								//
								if ( checkIndentClassLeft.call( this, firstBlock ) )
									return CKEDITOR.TRISTATE_OFF;
								else
									return CKEDITOR.TRISTATE_DISABLED;
							}

							else {
								//	+ indentContext in the path or ENTER_BR
								//	- IndentClasses
								//	+ Indenting
								//
								// 			No indent-level limitations due to indent classes.
								// 		    Indent-like command can always be executed.
								//
								if ( this.isIndent )
									return CKEDITOR.TRISTATE_OFF;

								//	+ indentContext in the path or ENTER_BR
								//	- IndentClasses
								//	- Indenting
								//	- Block in the path
								//
								// 			No block in path. There's no element to apply indentation
								// 		    so disable the command.
								//
								else if ( !firstBlock )
									return CKEDITOR.TRISTATE_DISABLED;

								//	+ indentContext in the path or ENTER_BR
								//	- IndentClasses
								//	- Indenting
								//	+ Block in path.
								//
								// 			Not using indentClasses but there is firstBlock.
								//		    We can calculate current indentation level and
								//			try to increase/decrease it.
								//
								else {
									var indent = getNumericalIndentLevel( firstBlock );

									if ( isNaN( indent ) )
										indent = 0;

									return CKEDITOR[ indent <= 0 ? 'TRISTATE_DISABLED' : 'TRISTATE_OFF' ];
								}
							}
						},

						exec: function( editor ) {
							var selection = editor.getSelection(),
								range = selection && selection.getRanges( 1 )[ 0 ],
								nearestListBlock;

							// If there's some list in the path, then it will be
							// a full-list indent by increasing or decreasing margin property.
							if ( ( nearestListBlock = editor.elementPath().contains( CKEDITOR.dtd.$list ) ) )
								indentElement.call( this, nearestListBlock );

							// If no list in the path, use iterator to indent all the possible
							// paragraphs in the range, creating them if necessary.
							else {
								var iterator = range.createIterator(),
									enterMode = editor.config.enterMode,
									block;

								iterator.enforceRealBlocks = true;
								iterator.enlargeBr = enterMode != CKEDITOR.ENTER_BR;

								while ( ( block = iterator.getNextParagraph( enterMode == CKEDITOR.ENTER_P ? 'p' : 'div' ) ) )
									indentElement.call( this, block );
							}

							return true;
						}
					}
				}
			}

			CKEDITOR.tools.extend( commandDefinition.prototype, globalHelpers.specificDefinition.prototype, {
				// Elements that, if in an elementpath, will be handled by this
				// command. They restrict the scope of the plugin.
				indentContext: { div: 1, dl: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1, ul: 1, ol: 1, p: 1, pre: 1, table: 1 },

				indentClasses: editor.config.indentClasses,

				classNameRegex: new RegExp( '(?:^|\\s+)(' + ( editor.config.indentClasses || [] ).join( '|' ) + ')(?=$|\\s)' )
			}, true );
		}
	} );

	/**
	 * Generic indentation procedure for any element shared across
	 * content-specific indentation commands.
	 *
	 *		// Indent element of id equal foo
	 *		var element = CKEDITOR.document.getById( 'foo' );
	 *		command.indentElement( element );
	 *
	 * @param {CKEDITOR.dom.element} element An element to be indented.
	 * @param {String} [dir] Element direction.
	 * @returns {Boolean}
	 */
	function indentElement( element, dir ) {
		if ( element.getCustomData( 'indent_processed' ) )
			return false;

		var editor = this.editor;

		if ( this.indentClasses ) {
			// Transform current class f to indent step index.
			var indentClass = element.$.className.match( this.classNameRegex ),
				indentStep = 0;
			if ( indentClass ) {
				indentClass = indentClass[ 1 ];
				indentStep = CKEDITOR.tools.indexOf( this.indentClasses, indentClass ) + 1;
			}

			// Operate on indent step index, transform indent step index back to class
			// name.
			if ( !this.isIndent )
				indentStep--;
			else
				indentStep++;

			if ( indentStep < 0 )
				return false;

			indentStep = Math.min( indentStep, this.indentClasses.length );
			indentStep = Math.max( indentStep, 0 );
			element.$.className = CKEDITOR.tools.ltrim( element.$.className.replace( this.classNameRegex, '' ) );

			if ( indentStep > 0 )
				element.addClass( this.indentClasses[ indentStep - 1 ] );
		} else {
			var indentCssProperty = getIndentCssProperty( element, dir ),
				currentOffset = parseInt( element.getStyle( indentCssProperty ), 10 ),
				indentOffset = editor.config.indentOffset || 40;

			if ( isNaN( currentOffset ) )
				currentOffset = 0;

			currentOffset += ( this.isIndent ? 1 : -1 ) * indentOffset;

			if ( currentOffset < 0 )
				return false;

			currentOffset = Math.max( currentOffset, 0 );
			currentOffset = Math.ceil( currentOffset / indentOffset ) * indentOffset;

			element.setStyle( indentCssProperty, currentOffset ? currentOffset + ( editor.config.indentUnit || 'px' ) : '' );

			if ( element.getAttribute( 'style' ) === '' )
				element.removeAttribute( 'style' );
		}

		CKEDITOR.dom.element.setMarker( this.database, element, 'indent_processed', 1 );

		return true;
	}

	/**
	 * Method that checks if current indentation level for an element
	 * reached the limit determined by {@link CKEDITOR.config#indentClasses}.
	 *
	 * @param {CKEDITOR.dom.element} node An element to be checked.
	 * @returns {Boolean}
	 */
	function checkIndentClassLeft( node ) {
		var indentClass = node.$.className.match( this.classNameRegex );

		// If node has one of the indentClasses:
		//	\-> If it holds the topmost indentClass, then
		//	    no more classes have left.
		//	\-> If it holds any other indentClass, it can use the next one
		//	    or the previous one.
		//	\-> Outdent is always possible. We can remove indentClass.
		if ( indentClass )
			return this.isIndent ? indentClass[ 1 ] != this.indentClasses.slice( -1 ) : true;

		// If node has no class which belongs to indentClasses,
		// then it is at 0-level. It can be indented but not outdented.
		else
			return this.isIndent;
	}

	/**
	 * Determines indent CSS property for an element according to
	 * what is the direction of such element. It can be either `margin-left`
	 * or `margin-right`.
	 *
	 *		// Get indent CSS property of an element.
	 *		var element = CKEDITOR.document.getById( 'foo' );
	 *		command.getIndentCssProperty( element );	// 'margin-left'
	 *
	 * @param {CKEDITOR.dom.element} element An element to be checked.
	 * @param {String} [dir] Element direction.
	 * @returns {String}
	 */
	function getIndentCssProperty( element, dir ) {
		return ( dir || element.getComputedStyle( 'direction' ) ) == 'ltr' ? 'margin-left' : 'margin-right';
	}

	/**
	 * Return the numerical indent value of margin-left|right of an element,
	 * considering element's direction. If element has no margin specified,
	 * NaN is returned.
	 *
	 * @param {CKEDITOR.dom.element} element An element to be checked.
	 * @returns {Number}
	 */
	function getNumericalIndentLevel( element ) {
		return parseInt( element.getStyle( getIndentCssProperty( element ) ), 10 );
	}
})();

/**
 * List of classes to use for indenting the contents. If it's `null`, no classes will be used
 * and instead the {@link #indentUnit} and {@link #indentOffset} properties will be used.
 *
 *		// Use the classes 'Indent1', 'Indent2', 'Indent3'
 *		config.indentClasses = ['Indent1', 'Indent2', 'Indent3'];
 *
 * @cfg {Array} [indentClasses=null]
 * @member CKEDITOR.config
 */
