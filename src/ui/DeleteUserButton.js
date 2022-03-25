import React from "react";
import { useNotify, useRedirect } from 'react-admin';
import Button from '@material-ui/core/Button'; 
import DeleteIcon from '@mui/icons-material/Delete';
import Dialog from '@material-ui/core/Dialog'; 
import DialogTitle from '@material-ui/core/DialogTitle'; 
import DialogContent from '@material-ui/core/DialogContent';
import { Form } from 'react-final-form';
import { useDeleteUser, useDeleteUserBulk } from '../lib/user'

export const DeleteUserButton = ({basePath, ...props}) => {
    
    const [open, setOpen] = React.useState(false);
    const notify = useNotify();
    const redirect = useRedirect();
    const deleteUser = useDeleteUser();
    const deleteUserBulk = useDeleteUserBulk();

    const handleSubmit = async values => {
        if (props.selectedIds) {
            await deleteUserBulk(props.selectedIds);
        } else {
            await deleteUser(props.record);
        }
        setOpen(false);
        notify('User(s) successfully deleted');
        redirect(props.redirect, basePath);    
    };
    
    return (
        <> 
        <Button aria-label="delete" onClick={() => setOpen(true)} variant={props.variant || "contained"} fontSize={props.size} color={props.color} >
            <DeleteIcon style={{ marginRight: '4px' }} size={props.size}/> { props.children }
        </Button> 
        <Dialog
            open={open}
            onClose={() => setOpen(false)}
            aria-labelledby="form-dialog-title"
        >
        <DialogTitle id="form-dialog-title"> Delete User(s) </DialogTitle>
        <DialogContent>
            Note: this action will be irreversible<br/><br/>
            <Form
                onSubmit={handleSubmit}
                render={({handleSubmit, form, submitting, pristine, values }) => (
                    <form onSubmit={handleSubmit}>
                        <Button variant="contained" color="primary" type="submit" disabled={submitting}>
                            Confirm Delete
                        </Button>
                    </form>
                )}
            />
        </DialogContent>        
        </Dialog>
        </>        
    );
}

export default DeleteUserButton;